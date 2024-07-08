import { AsyncLocalStorage } from 'node:async_hooks'

import { SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api'
import { SEMATTRS_MESSAGING_DESTINATION, SEMATTRS_MESSAGING_SYSTEM, SEMATTRS_RPC_SYSTEM } from '@opentelemetry/semantic-conventions'
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
import protobuf from 'protobufjs'

import { MetricsService, RequestMechanism, RequestStatus } from '@diia-inhouse/diia-metrics'
import { QueueContext } from '@diia-inhouse/diia-queue'
import { LogData, Logger } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'

import { CallOptions } from '../interfaces/grpc'

import wrappers from './wrappers'

export class GrpcClientFactory {
    constructor(
        private readonly serviceName: string,
        private readonly logger: Logger,
        private readonly metrics: MetricsService,

        private readonly asyncLocalStorage?: AsyncLocalStorage<QueueContext>,
    ) {
        Object.assign(protobuf.wrappers, wrappers)
    }

    createGrpcClient<Service extends TsProtoServiceDefinition>(
        definition: Service,
        serviceAddress: string,
        channelOptions: ChannelOptions = {},
    ): Client<Service> {
        const channelImplementation = createChannel(serviceAddress, ChannelCredentials.createInsecure(), channelOptions)

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

            const defaultLabels = {
                mechanism: RequestMechanism.Grpc,
                source: self.serviceName,
                destination: destinationServiceName,
                route: path,
            }

            const logData = self.asyncLocalStorage?.getStore()?.logData ?? {}

            const meta = options.metadata || new Metadata()

            for (const key in logData) {
                const value = logData[<keyof LogData>key]
                if (key !== 'actionVersion' && value && !meta.has(key)) {
                    meta.set(key, value)
                }
            }

            const tracer = trace.getTracer(self.serviceName)
            const span = tracer.startSpan(
                `send ${path}`,
                {
                    kind: SpanKind.CLIENT,
                    attributes: {
                        [SEMATTRS_MESSAGING_SYSTEM]: RequestMechanism.Grpc,
                        [SEMATTRS_MESSAGING_DESTINATION]: destinationServiceName,
                        [SEMATTRS_RPC_SYSTEM]: RequestMechanism.Grpc,
                    },
                },
                context.active(),
            )
            const tracing = <{ traceparent?: string; tracestate?: string }>{}

            propagation.inject(trace.setSpan(context.active(), span), tracing)
            meta.set('tracing', JSON.stringify(tracing))

            if (tracing.traceparent) {
                meta.set('traceparent', tracing.traceparent)
            }

            if (tracing.tracestate) {
                meta.set('tracestate', tracing.tracestate)
            }

            for (const kv of meta) {
                const [key, value] = kv

                if (ArrayBuffer.isView(value)) {
                    continue
                }

                try {
                    if ((<string[]>value).length > 1) {
                        span.setAttribute(`rpc.grpc.request.metadata.${key}`, <string[]>value)
                    } else if ((<string[]>value).length === 1) {
                        span.setAttribute(`rpc.grpc.request.metadata.${key}`, <string>(<string[]>value)[0])
                    }
                } catch {
                    // ignore result
                }
            }

            options.metadata = meta

            try {
                const grpcResult: void | Awaited<Response> = yield* call.next(call.request, options)

                self.metrics.totalTimerMetric.observeSeconds(
                    { ...defaultLabels, status: RequestStatus.Successful },
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

        try {
            const grpcResult = yield* call.next(request, options)

            this.logger.info(`ACT OUT RESULT: ${path}`, grpcResult)

            return grpcResult
        } catch (err) {
            utils.handleError(err, (apiError) => {
                this.logger.error(`ACT OUT FAILED: ${path}`, { err: apiError })
            })

            throw err
        }
    }

    private async *errorHandlerMiddleware<Request, Response>(
        call: ClientMiddlewareCall<Request, Response>,
        options: CallOptions,
    ): AsyncGenerator<Awaited<Response>, void | Awaited<Response>, undefined> {
        const { request } = call

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
            utils.handleError(err, (apiError) => {
                const processCodeRaw = trailer?.get('processcode')
                const processCode = processCodeRaw ? Number.parseInt(processCodeRaw, 10) : undefined
                if (processCode) {
                    apiError.setProcessCode(processCode)
                }

                throw apiError
            })
        }
    }
}
