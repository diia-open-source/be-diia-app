import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

import { Span, SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api'
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
import { ApiError } from '@diia-inhouse/errors'
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
import { ATTR_MESSAGING_DESTINATION_NAME, ATTR_MESSAGING_SYSTEM } from '../interfaces/tracing'
import { ACTION_PARAMS, ACTION_RESPONSE } from '../plugins/pluginConstants'
import MoleculerLogger from './moleculerLogger'

export default class MoleculerService implements OnInit, OnDestroy {
    serviceBroker: ServiceBroker

    service!: Service

    constructor(
        private readonly serviceName: string,
        private readonly systemServiceName: string,
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
        this.serviceBroker = new ServiceBroker(this.createBrokerOptions())
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
        const defaultLabels: { mechanism: RequestMechanism; source: string; route: string; destination?: string } = {
            mechanism: RequestMechanism.Moleculer,
            source: this.systemServiceName,
            route: actionName,
        }

        try {
            const broker: ServiceBroker = this.serviceBroker

            const tracer = trace.getTracer(this.systemServiceName)

            span = tracer.startSpan(
                `send ${actionName}`,
                {
                    kind: SpanKind.PRODUCER,
                    attributes: {
                        [ATTR_MESSAGING_SYSTEM]: RequestMechanism.Moleculer,
                        [ATTR_MESSAGING_DESTINATION_NAME]: serviceName,
                    },
                },
                context.active(),
            )
            const tracing = {}

            propagation.inject(trace.setSpan(context.active(), span), tracing)
            const { params = {}, session, headers: argsHeaders } = args || {}

            const headers = { ...this.asyncLocalStorage.getStore()?.logData, ...argsHeaders }
            const argsWithParams: Record<string, unknown> = { params, session, headers }
            // according to moleculer docs ctx.meta is used for two-way metadata exchange between caller and server
            const callingOpts = { ...opts, meta: { tracing: { ...tracing, sentFrom: this.systemServiceName, handledBy: '' } } }

            this.logger.info(`ACT OUT: ${serviceActionName}`, {
                params,
                session,
                argsHeaders,
                service: serviceName,
                action: actionName,
                callingOpts,
            })
            const res = await broker.call<T, typeof argsWithParams>(serviceActionName, argsWithParams, callingOpts)

            if (callingOpts.meta.tracing.handledBy !== '') {
                defaultLabels.destination = callingOpts.meta.tracing.handledBy
            }

            span.setStatus({ code: SpanStatusCode.OK })
            span.end()
            this.logger.info(`ACT OUT RESULT: ${serviceActionName}`, res)

            this.metrics.totalTimerMetric.observeSeconds(
                { ...defaultLabels, status: RequestStatus.Successful },
                process.hrtime.bigint() - startTime,
            )

            return res
        } catch (err) {
            return utils.handleError(err, (apiErr) => {
                const data = apiErr.getData()
                const type = apiErr.getType()
                const code = apiErr.getCode()
                const message = apiErr.getMessage()
                const name = apiErr.getName()

                data.opOriginalError ||= { type }

                span?.recordException({
                    message,
                    code,
                    name,
                })

                span?.setStatus({ code: SpanStatusCode.ERROR, message })

                this.metrics.totalTimerMetric.observeSeconds(
                    {
                        ...defaultLabels,
                        status: RequestStatus.Failed,
                        errorType: type,
                        statusCode: code,
                    },
                    process.hrtime.bigint() - startTime,
                )

                span?.end()

                this.logger.error(`ACT OUT FAILED: ${serviceActionName}`, { err, service: serviceName, action: actionName, args })

                throw new ApiError(message, code, data)
            })
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

    private createBrokerOptions(): BrokerOptions {
        const brokerOptions: BrokerOptions = {
            nodeID: `${this.systemServiceName}-${randomUUID()}`,
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
                            defaultLabels: (registry: { broker: { nasmespace: string; nodeID: string } }): Record<string, unknown> => ({
                                namespace: registry.broker.nasmespace,
                                nodeID: registry.broker.nodeID,
                            }),
                        },
                    },
                ],
            },
            skipProcessEventRegistration: true,
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

        return brokerOptions
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

            meta.tracing ??= {}
            meta.tracing.handledBy = this.systemServiceName

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
