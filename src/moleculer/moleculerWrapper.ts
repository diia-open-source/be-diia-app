import { AsyncLocalStorage } from 'node:async_hooks'

import { Span, SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api'
import { SEMATTRS_MESSAGING_DESTINATION, SEMATTRS_MESSAGING_SYSTEM } from '@opentelemetry/semantic-conventions'
import cookieParser from 'cookie-parser'
import { extend } from 'lodash'
import {
    ActionHandler,
    ActionSchema,
    BrokerOptions,
    CallingOptions,
    Context,
    Service,
    ServiceActionsSchema,
    ServiceBroker,
    ServiceEvents,
    ServiceSchema,
} from 'moleculer'
import ApiService from 'moleculer-web'

import { MetricsService, RequestMechanism, RequestStatus } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { RedlockService } from '@diia-inhouse/redis'
import {
    ActArguments,
    ActionArguments,
    ActionVersion,
    AlsData,
    CallActionNameVersion,
    Logger,
    OnDestroy,
    OnInit,
} from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'

import { ActionExecutor } from '../actionExecutor'
import { AppAction, AppApiService, BaseConfig } from '../interfaces'
import { ContextMeta } from '../interfaces/moleculer'
import { ACTION_PARAMS, ACTION_RESPONSE } from '../plugins/pluginConstants'

import MoleculerLogger from './moleculerLogger'

export default class MoleculerService implements OnInit, OnDestroy {
    serviceBroker: ServiceBroker

    service!: Service

    constructor(
        private readonly serviceName: string,
        private readonly actionExecutor: ActionExecutor,
        private readonly actionList: AppAction[],

        private readonly config: BaseConfig,
        private readonly asyncLocalStorage: AsyncLocalStorage<AlsData>,
        private readonly logger: Logger,
        private readonly envService: EnvService,

        private readonly metrics: MetricsService,

        private readonly moleculerEvents: ServiceEvents = {},
        private readonly apiService: AppApiService | null = null,
        private readonly redlock: RedlockService | null = null,
    ) {
        const brokerOptions: BrokerOptions = {
            transporter: this.config.transporter,
            logger: new MoleculerLogger(this.logger),
            logLevel: 'warn',
            registry: {
                strategy: this.config.balancing?.strategy || 'RoundRobin',
                strategyOptions: this.config.balancing?.strategyOptions || {},
            },
            tracking: {
                enabled: process.env.CONTEXT_TRACKING_ENABLED ? process.env.CONTEXT_TRACKING_ENABLED === 'true' : true,
                shutdownTimeout: process.env.CONTEXT_TRACKING_TIMEOUT ? Number.parseInt(process.env.CONTEXT_TRACKING_TIMEOUT, 10) : 10000,
            },
            metrics: {
                enabled: this.config.metrics?.moleculer?.prometheus?.isEnabled || false,
                reporter: [
                    {
                        type: 'Prometheus',
                        options: {
                            port: this.config.metrics?.moleculer?.prometheus?.port ?? 3031,
                            path: this.config.metrics?.moleculer?.prometheus?.path,
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            defaultLabels: (registry: any): Record<string, unknown> => ({
                                namespace: registry.broker.nasmespace,
                                nodeID: registry.broker.nodeID,
                            }),
                        },
                    },
                ],
            },
        }

        if (this.config.tracing) {
            const {
                zipkin: { isEnabled, baseURL, sendIntervalSec },
            } = this.config.tracing

            brokerOptions.tracing = {
                enabled: isEnabled,
                exporter: {
                    type: 'Zipkin',
                    options: {
                        baseURL,
                        interval: sendIntervalSec,
                        payloadOptions: {
                            debug: false,
                            shared: false,
                        },
                        defaultTags: null,
                    },
                },
            }
        }

        this.serviceBroker = new ServiceBroker(brokerOptions)
    }

    async onInit(): Promise<void> {
        const serviceActions = this.createActions(this.actionList)
        const serviceSchema: ServiceSchema = { name: this.serviceName, actions: serviceActions, events: this.moleculerEvents ?? {} }
        const options = this.addApiService(serviceSchema)

        this.service = this.serviceBroker.createService(options)

        await this.serviceBroker.start()
    }

    async onDestroy(): Promise<void> {
        await this.serviceBroker.stop()
    }

    async act<T>(
        serviceName: string,
        { name, actionVersion }: CallActionNameVersion,
        args?: ActArguments,
        opts?: CallingOptions,
    ): Promise<T> {
        const actionName: string = utils.getActionNameWithVersion(name, actionVersion)
        const serviceActionName = `${serviceName}.${actionName}`
        let span: Span | undefined
        const startTime = process.hrtime.bigint()
        const defaultLabels = {
            mechanism: RequestMechanism.Moleculer,
            source: this.serviceName,
            destination: serviceName,
            route: serviceActionName,
        }

        try {
            const broker: ServiceBroker = this.serviceBroker

            const tracer = trace.getTracer(this.serviceName)

            span = tracer.startSpan(
                `send ${serviceActionName}`,
                {
                    kind: SpanKind.PRODUCER,
                    attributes: {
                        [SEMATTRS_MESSAGING_SYSTEM]: RequestMechanism.Moleculer,
                        [SEMATTRS_MESSAGING_DESTINATION]: serviceName,
                    },
                },
                context.active(),
            )
            const tracing = {}

            propagation.inject(trace.setSpan(context.active(), span), tracing)
            const { params = {}, session, headers: argsHeaders } = args || {}

            const headers = { ...this.asyncLocalStorage.getStore()?.logData, ...argsHeaders }
            const argsWithParams: Record<string, unknown> = { params, session, headers }
            const callingOpts = { ...opts, meta: { tracing } }

            this.logger.info(`ACT OUT: ${serviceActionName}`, {
                params,
                session,
                argsHeaders,
                service: serviceName,
                action: actionName,
                callingOpts,
            })
            const res = await broker.call<T, typeof argsWithParams>(serviceActionName, argsWithParams, callingOpts)

            span.setStatus({ code: SpanStatusCode.OK })
            span.end()
            this.logger.info(`ACT OUT RESULT: ${serviceActionName}`, res)

            this.metrics.totalTimerMetric.observeSeconds(
                { ...defaultLabels, status: RequestStatus.Successful },
                process.hrtime.bigint() - startTime,
            )

            return res
        } catch (err) {
            utils.handleError(err, (apiErr) => {
                span?.recordException({
                    message: apiErr.getMessage(),
                    code: apiErr.getCode(),
                    name: apiErr.getName(),
                })
                span?.setStatus({ code: SpanStatusCode.ERROR, message: apiErr.getMessage() })

                this.metrics.totalTimerMetric.observeSeconds(
                    {
                        ...defaultLabels,
                        status: RequestStatus.Failed,
                        errorType: apiErr.getType(),
                        statusCode: apiErr.getCode(),
                    },
                    process.hrtime.bigint() - startTime,
                )
            })

            span?.end()

            this.logger.error(`ACT OUT FAILED: ${serviceActionName}`, { err, service: serviceName, action: actionName, args })
            throw err
        }
    }

    async tryToAct<T>(
        serviceName: string,
        callActionNameVersion: CallActionNameVersion,
        args?: ActArguments,
        opts?: CallingOptions,
    ): Promise<T | undefined> {
        try {
            return await this.act(serviceName, callActionNameVersion, args, opts)
        } catch {
            return
        }
    }

    private addApiService(serviceSchema: ServiceSchema): ServiceSchema {
        const { cors } = this.config
        if (!this.apiService || !cors) {
            return serviceSchema
        }

        const extendedOptions = extend(serviceSchema, {
            mixins: [ApiService],
            settings: {
                port: this.apiService.port,
                routes: this.apiService.routes,
                cors: {
                    origin: cors.origins.join(', '),
                    methods: cors.methods,
                    allowedHeaders: cors.allowedHeaders,
                    exposedHeaders: cors.exposedHeaders,
                    credentials: cors.credentials,
                    maxAge: cors.maxAge,
                },
                mergeParams: true,
                use: [cookieParser()],
                qsOptions: {
                    arrayLimit: 40,
                },
                logRequest: 'debug',
                logResponse: 'debug',
                logRouteRegistration: 'debug',
                log4XXResponses: false,
            },
            methods: this.apiService.methods,
        })

        if (this.apiService.ip) {
            extendedOptions.settings.ip = this.apiService.ip
        }

        return extendedOptions
    }

    private createActions(actions: AppAction[]): ServiceActionsSchema {
        this.logger.info('Start actions initialization')

        try {
            const serviceActions: ServiceActionsSchema = {}

            for (const action of actions) {
                let actionVersion: ActionVersion | undefined
                if (action.actionVersion !== undefined) {
                    actionVersion = action.actionVersion
                }

                const command = utils.getActionNameWithVersion(action.name, actionVersion)

                serviceActions[command] = this.addAction(action)

                this.logger.info(`Action [${command}] initialized successfully`)
            }

            return serviceActions
        } catch (err) {
            this.logger.error('Failed to init actions', { err })
            throw err
        }
    }

    private addAction(action: AppAction): ActionSchema {
        if (action.getLockResource && !this.redlock) {
            throw new Error('Lock resource cannot be used without a redlock service')
        }

        const handler: ActionHandler = async (ctx: Context<ActionArguments, ContextMeta>): Promise<unknown> => {
            const { caller, meta, params } = ctx

            return await this.actionExecutor.execute({
                action,
                caller: caller || undefined,
                tracingMetadata: meta?.tracing,
                actionArguments: params,
                transport: RequestMechanism.Moleculer,
                spanKind: SpanKind.CONSUMER,
            })
        }

        if (this.envService.isProd()) {
            return { handler }
        }

        return {
            handler,
            [ACTION_PARAMS]: action.validationRules ? { params: { type: 'object', props: action.validationRules } } : {},
            [ACTION_RESPONSE]: action[ACTION_RESPONSE],
        }
    }
}
