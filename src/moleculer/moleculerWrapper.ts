import { AsyncLocalStorage } from 'async_hooks'

import { Span, SpanKind, context, propagation, trace } from '@opentelemetry/api'
import { SemanticAttributes } from '@opentelemetry/semantic-conventions'
import cookieParser from 'cookie-parser'
import { extend } from 'lodash'
import { BrokerOptions, CallingOptions, Service, ServiceBroker, ServiceEvents, ServiceSchema } from 'moleculer'
import ApiService from 'moleculer-web'

import { MetricsService, RequestMechanism, RequestStatus } from '@diia-inhouse/diia-metrics'
import { ActArguments, AlsData, CallActionNameVersion, Logger, OnDestroy, OnInit } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'
import { AppValidator } from '@diia-inhouse/validators'

import ActionFactory from '../actionFactory'
import { actionTypesJsonParse } from '../actionJsonConvertor'
import { AppAction, AppApiService, BaseConfig } from '../interfaces'

import MoleculerLogger from './moleculerLogger'
import MoleculerValidator from './moleculerValidator'

export default class MoleculerService implements OnInit, OnDestroy {
    serviceBroker: ServiceBroker

    service!: Service

    constructor(
        private readonly serviceName: string,
        private readonly actionFactory: ActionFactory,
        private readonly actionList: AppAction[],

        private readonly config: BaseConfig,
        private readonly asyncLocalStorage: AsyncLocalStorage<AlsData>,
        private readonly validator: AppValidator,
        private readonly logger: Logger,

        private readonly metrics: MetricsService,

        private readonly moleculerEvents: ServiceEvents = {},
        private readonly apiService: AppApiService = <AppApiService>{},
    ) {
        const brokerOptions: BrokerOptions = {
            transporter: this.config.transporter,
            validator: new MoleculerValidator(this.validator),
            logger: new MoleculerLogger(this.logger),
            logLevel: 'warn',
            registry: {
                strategy: this.config.balancing?.strategy || 'RoundRobin',
                strategyOptions: this.config.balancing?.strategyOptions || {},
            },
            tracking: {
                enabled: process.env.CONTEXT_TRACKING_ENABLED ? process.env.CONTEXT_TRACKING_ENABLED === 'true' : true,
                shutdownTimeout: process.env.CONTEXT_TRACKING_TIMEOUT ? parseInt(process.env.CONTEXT_TRACKING_TIMEOUT, 10) : 10000,
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
        const serviceActions = this.actionFactory.createActions(this.actionList)
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
                        [SemanticAttributes.MESSAGING_SYSTEM]: RequestMechanism.Moleculer,
                        [SemanticAttributes.MESSAGING_DESTINATION]: serviceName,
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

            this.logger.io(`ACT OUT: ${serviceActionName}`, {
                params,
                session,
                argsHeaders,
                service: serviceName,
                action: actionName,
                callingOpts,
            })
            const res = <T>actionTypesJsonParse(await broker.call(serviceActionName, argsWithParams, callingOpts))

            span.end()
            this.logger.io(`ACT OUT RESULT: ${serviceActionName}`, res)

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
            },
            methods: this.apiService.methods,
        })

        if (this.apiService.ip) {
            extendedOptions.settings.ip = this.apiService.ip
        }

        return extendedOptions
    }
}
