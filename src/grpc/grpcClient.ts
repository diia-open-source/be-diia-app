import { AsyncLocalStorage } from 'node:async_hooks'

import { SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api'
import {
    ChannelCredentials,
    ChannelOptions,
    Client,
    ClientMiddlewareCall,
    Metadata,
    TsProtoServiceDefinition,
    createChannel,
    createClientFactory,
} from 'nice-grpc'
import { deadlineMiddleware } from 'nice-grpc-client-middleware-deadline'

import { MetricsService, RequestMechanism, RequestStatus, TotalRequestsLabelsMap } from '@diia-inhouse/diia-metrics'
import { QueueContext } from '@diia-inhouse/diia-queue'
import { ApiError } from '@diia-inhouse/errors'
import { GrpcStatusCode, LogData, Logger, grpcMetadataKeys } from '@diia-inhouse/types'
import { NetworkUtils, utils } from '@diia-inhouse/utils'

import { CallOptions, GrpcClientMetadata } from '../interfaces/grpc'
import { ATTR_RPC_GRPC_DESTINATION_SERVICE_NAME, ATTR_RPC_GRPC_REQUEST_METADATA, ATTR_RPC_SYSTEM } from '../interfaces/tracing'
import { bindAsyncGenerator } from './utils'
import { registerWrappers } from './wrappers'

export class GrpcClientFactory {
    constructor(
        private readonly systemServiceName: string,
        private readonly logger: Logger,
        private readonly metrics: MetricsService,

        private readonly asyncLocalStorage?: AsyncLocalStorage<QueueContext>,
    ) {
        registerWrappers(this.logger)
    }

    createGrpcClient<Service extends TsProtoServiceDefinition>(
        definition: Service,
        serviceAddress: string,
        channelOptions: ChannelOptions = {},
    ): Client<Service> {
        const defaultOptions: ChannelOptions = {
            'grpc.keepalive_timeout_ms': 10000,
            'grpc.keepalive_time_ms': 15000,
            'grpc.keepalive_permit_without_calls': 1,
        }

        const channelImplementation = createChannel(serviceAddress, ChannelCredentials.createInsecure(), {
            ...defaultOptions,
            ...channelOptions,
        })

        return createClientFactory()
            .use(this.loggingMiddleware.bind(this))
            .use(this.metadataMiddleware.bind(this)(definition.name))
            .use(this.errorHandlerMiddleware.bind(this))
            .use(deadlineMiddleware)
            .create(definition, channelImplementation)
    }

    private metadataMiddleware(
        destinationServiceName: string,
    ): <Request, Response>(
        call: ClientMiddlewareCall<Request, Response>,
        options: CallOptions,
    ) => AsyncGenerator<Awaited<Response>, void | Awaited<Response>, undefined> {
        // eslint-disable-next-line @typescript-eslint/no-this-alias, unicorn/no-this-assignment
        const self = this

        return async function* <Request, Response>(
            call: ClientMiddlewareCall<Request, Response>,
            options: CallOptions,
        ): AsyncGenerator<Awaited<Response>, void | Awaited<Response>, undefined> {
            const startTime = process.hrtime.bigint()
            const { path } = call.method

            const defaultLabels: Partial<TotalRequestsLabelsMap> = {
                mechanism: RequestMechanism.Grpc,
                source: self.systemServiceName,
                route: path,
            }

            const logData = self.asyncLocalStorage?.getStore()?.logData ?? {}

            const meta = options.metadata || new Metadata()

            for (const key in logData) {
                const value = logData[key as keyof LogData]
                if (key !== 'actionVersion' && value && !meta.has(key)) {
                    meta.set(key, value)
                }
            }

            const tracer = trace.getTracer(self.systemServiceName)
            const span = tracer.startSpan(
                `send ${path}`,
                {
                    kind: SpanKind.CLIENT,
                    attributes: {
                        [ATTR_RPC_SYSTEM]: RequestMechanism.Grpc,
                        [ATTR_RPC_GRPC_DESTINATION_SERVICE_NAME]: destinationServiceName,
                    },
                },
                context.active(),
            )

            const tracing = {} as { traceparent?: string; tracestate?: string }

            propagation.inject(trace.setSpan(context.active(), span), tracing)
            meta.set(grpcMetadataKeys.TRACING, JSON.stringify(tracing))

            if (tracing.traceparent) {
                meta.set(grpcMetadataKeys.TRACE_PARENT, tracing.traceparent)
            }

            if (tracing.tracestate) {
                meta.set(grpcMetadataKeys.TRACE_STATE, tracing.tracestate)
            }

            meta.set(grpcMetadataKeys.SENT_FROM, self.systemServiceName)

            for (const kv of meta) {
                const [key, value] = kv

                if (ArrayBuffer.isView(value)) {
                    continue
                }

                const sessionKey: keyof GrpcClientMetadata = 'session'
                if (key === sessionKey) {
                    continue
                }

                try {
                    if ((value as string[]).length > 1) {
                        span.setAttribute(ATTR_RPC_GRPC_REQUEST_METADATA(key), value as string[])
                    } else if ((value as string[]).length === 1) {
                        span.setAttribute(ATTR_RPC_GRPC_REQUEST_METADATA(key), (value as string[])[0] as string)
                    }
                } catch {
                    // ignore result
                }
            }

            options.metadata = meta
            options.onHeader = (header: Metadata): void => {
                if (header.get(grpcMetadataKeys.HANDLED_BY)) {
                    defaultLabels.destination = header.get(grpcMetadataKeys.HANDLED_BY)
                }
            }

            try {
                const grpcResult: void | Awaited<Response> = yield* bindAsyncGenerator(
                    trace.setSpan(context.active(), span),
                    call.next(call.request, options),
                )

                self.metrics.totalTimerMetric.observeSeconds(
                    { ...defaultLabels, status: RequestStatus.Successful, statusCode: GrpcStatusCode.OK },
                    process.hrtime.bigint() - startTime,
                )
                span.setStatus({ code: SpanStatusCode.OK })

                return grpcResult
            } catch (err) {
                utils.handleError(err, (apiError) => {
                    self.metrics.totalTimerMetric.observeSeconds(
                        {
                            ...defaultLabels,
                            status: RequestStatus.Failed,
                            errorType: apiError.getType(),
                            statusCode: apiError.getCode(),
                        },
                        process.hrtime.bigint() - startTime,
                    )

                    span.recordException({
                        message: apiError.getMessage(),
                        code: apiError.getCode(),
                        name: apiError.getName(),
                    })
                    span.setStatus({ code: SpanStatusCode.ERROR, message: apiError.getMessage() })
                })

                throw err
            } finally {
                span.end()
            }
        }
    }

    private async *loggingMiddleware<Request, Response>(
        call: ClientMiddlewareCall<Request, Response>,
        options: CallOptions,
    ): AsyncGenerator<Awaited<Response>, void | Awaited<Response>, undefined> {
        const {
            request,
            method: { path },
        } = call

        this.logger.info(`ACT OUT: ${path}`, { transport: 'grpc', params: request })
        const grpcResult = yield* call.next(request, options)

        this.logger.info(`ACT OUT RESULT: ${path}`, grpcResult)

        return grpcResult
    }

    private async *errorHandlerMiddleware<Request, Response>(
        call: ClientMiddlewareCall<Request, Response>,
        options: CallOptions,
    ): AsyncGenerator<Awaited<Response>, void | Awaited<Response>, undefined> {
        const {
            request,
            method: { path },
        } = call

        let trailer: Metadata | undefined
        try {
            const grpcResult = yield* call.next(request, {
                ...options,
                onTrailer(receivedTrailer) {
                    trailer = receivedTrailer

                    options.onTrailer?.(trailer)
                },
            })

            return grpcResult
        } catch (err) {
            const handledError = utils.handleError(err, (apiError) => {
                const originalErrorRaw = trailer?.get(grpcMetadataKeys.ORIGINAL_ERROR)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const originalError: any = originalErrorRaw ? utils.decodeValuesWithIterator(JSON.parse(originalErrorRaw)) : null

                if (originalError) {
                    originalError.data ||= {}
                    originalError.data.opOriginalError ||= { type: originalError.type }

                    return new ApiError(
                        apiError.getMessage(),
                        NetworkUtils.getHttpStatusCodeByGrpcCode(apiError.getCode()),
                        originalError.data,
                        originalError.data?.processCode,
                    )
                }

                const processCodeRaw = trailer?.get(grpcMetadataKeys.PROCESS_CODE)
                const processCode = processCodeRaw ? Number.parseInt(processCodeRaw, 10) : undefined

                if (processCode) {
                    apiError.setProcessCode(processCode)
                }

                return apiError
            })

            this.logger.error(`ACT OUT FAILED: ${path}`, { err: handledError })

            throw handledError
        }
    }
}
