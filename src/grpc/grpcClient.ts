import { AsyncLocalStorage } from 'async_hooks'

import { SpanKind, context, propagation, trace } from '@opentelemetry/api'
import { SemanticAttributes } from '@opentelemetry/semantic-conventions'
import { ChannelCredentials, Client, ClientMiddlewareCall, Metadata, createChannel, createClientFactory } from 'nice-grpc'
import { CompatServiceDefinition } from 'nice-grpc/lib/service-definitions'
import { deadlineMiddleware } from 'nice-grpc-client-middleware-deadline'
import protobuf from 'protobufjs'

import { MetricsService, RequestMechanism, RequestStatus } from '@diia-inhouse/diia-metrics'
import { QueueContext } from '@diia-inhouse/diia-queue'
import { LogData, Logger } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'

import { CallOptions, GrpcClientMetadata } from '../interfaces'

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

    createGrpcClient<Service extends CompatServiceDefinition>(
        definition: Service,
        serviceAddress: string,
        serviceName: string,
    ): Client<Service> {
        const channelImplementation = createChannel(serviceAddress, ChannelCredentials.createInsecure())

        return createClientFactory()
            .use(this.loggingMiddleware.bind(this))
            .use(this.metadataMiddleware.bind(this)(serviceName))
            .use(deadlineMiddleware)
            .create(definition, channelImplementation)
    }

    private metadataMiddleware(
        destinationServiceName: string,
    ): <Request, Response>(
        call: ClientMiddlewareCall<Request, Response>,
        options: CallOptions,
    ) => AsyncGenerator<Awaited<Response>, void | Awaited<Response>, undefined> {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
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

            const meta = options.metadata

            for (const key in logData) {
                const value = logData[<keyof LogData>key]
                if (value && !meta?.has(key)) {
                    meta?.set(key, value)
                }
            }

            const tracer = trace.getTracer(self.serviceName)
            const span = tracer.startSpan(
                `send ${path}`,
                {
                    kind: SpanKind.CLIENT,
                    attributes: {
                        [SemanticAttributes.MESSAGING_SYSTEM]: RequestMechanism.Grpc,
                        [SemanticAttributes.MESSAGING_DESTINATION]: destinationServiceName,
                    },
                },
                context.active(),
            )
            const tracing = {}

            propagation.inject(trace.setSpan(context.active(), span), tracing)
            meta?.set('tracing', JSON.stringify(tracing))

            options.metadata = meta

            try {
                const grpcResult: void | Awaited<Response> = yield* call.next(call.request, options)

                self.metrics.totalTimerMetric.observeSeconds(
                    { ...defaultLabels, status: RequestStatus.Successful },
                    process.hrtime.bigint() - startTime,
                )

                return grpcResult
            } catch (err) {
                await utils.handleError(err, (apiError) => {
                    self.metrics.totalTimerMetric.observeSeconds(
                        {
                            ...defaultLabels,
                            status: RequestStatus.Failed,
                            errorType: apiError.getType(),
                            statusCode: apiError.getCode(),
                        },
                        process.hrtime.bigint() - startTime,
                    )
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
        const { path } = call.method

        this.logger.io(`ACT OUT: ${path}`, { transport: 'grpc' })

        try {
            const grpcResult: void | Awaited<Response> = yield* call.next(call.request, options)

            this.logger.io(`ACT OUT RESULT: ${path}`, grpcResult)

            return grpcResult
        } catch (e) {
            await utils.handleError(e, (apiError) => {
                this.logger.error(`ACT OUT FAILED: ${path}`, { err: apiError })
            })

            throw e
        }
    }
}

export function clientCallOptions(grpcMetadata: GrpcClientMetadata): CallOptions {
    const metadata = new Metadata()

    const { session, version, deadline } = grpcMetadata

    if (session) {
        metadata.set('session', Buffer.from(JSON.stringify(session)).toString('base64'))
    }

    if (version) {
        metadata.set('actionversion', version)
    }

    return {
        metadata,
        deadline,
    }
}
