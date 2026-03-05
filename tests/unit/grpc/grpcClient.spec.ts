import { CallOptions, ClientMiddleware, ClientMiddlewareCall, TsProtoServiceDefinition } from 'nice-grpc'
import { mock } from 'vitest-mock-extended'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import TestKit from '@diia-inhouse/test'
import { ActionVersion, grpcMetadataKeys } from '@diia-inhouse/types'

import { GrpcClientFactory, clientCallOptions } from '../../../src/grpc'

const generatorValue = 'generatorResult'

const call = {
    method: {
        path: '/test/',
    },
    next: function* () {
        yield generatorValue
    },
    request: '',
} as unknown as ClientMiddlewareCall<Request, Response>

const options = {} as unknown as CallOptions

const client = {}

vi.mock('nice-grpc', async (importOriginal) => {
    const originalModule = await importOriginal<typeof import('nice-grpc')>()

    return {
        __esModule: true,
        ...originalModule,
        createChannel: vi.fn(),
        ChannelCredentials: {
            createInsecure: vi.fn(),
        },
        createClientFactory: (): unknown => ({
            use: (loggingMiddleware: ClientMiddleware) => ({
                use: (metadataMiddleware: ClientMiddleware): object => ({
                    use: (errorHandlerMiddleware: ClientMiddleware): object => ({
                        use: (deadlineMiddleware: ClientMiddleware): object => ({
                            create: async (): Promise<object> => {
                                let result = await loggingMiddleware(call, options)

                                let generatorResult = await result.next()

                                expect(generatorResult).toStrictEqual({
                                    value: generatorValue,
                                    done: false,
                                })

                                result = await metadataMiddleware(call, options)
                                generatorResult = await result.next()

                                expect(generatorResult).toStrictEqual({
                                    value: generatorValue,
                                    done: false,
                                })

                                result = await errorHandlerMiddleware(call, options)
                                generatorResult = await result.next()

                                expect(generatorResult).toStrictEqual({
                                    value: generatorValue,
                                    done: false,
                                })

                                result = await deadlineMiddleware(call, options)
                                generatorResult = await result.next()

                                expect(generatorResult).toStrictEqual({
                                    value: generatorValue,
                                    done: false,
                                })

                                return client
                            },
                        }),
                    }),
                }),
            }),
        }),
    }
})

describe('grpcClientFactory', () => {
    const serviceName = 'Auth'
    const logger = mock<DiiaLogger>()
    const metrics = mock<MetricsService>()

    const grpcClientFactory = new GrpcClientFactory(serviceName, logger, metrics)

    it('should create client', async () => {
        const definition: TsProtoServiceDefinition = { name: 'Test', fullName: 'ua.Test', methods: {} }
        const serviceAddress = 'ua.gov.diia.publicservice.service-with-action'

        await expect(grpcClientFactory.createGrpcClient(definition, serviceAddress)).resolves.toStrictEqual(client)
    })
})

describe('function clientCallOptions', () => {
    const testKit = new TestKit()

    it('should create metadata', () => {
        const grpcMetadata = {
            session: testKit.session.getUserSession(),
            version: ActionVersion.V0,
            deadline: 0,
        }

        const { metadata, deadline } = clientCallOptions(grpcMetadata)

        expect(deadline).toBe(0)
        expect(metadata?.get(grpcMetadataKeys.ACTION_VERSION)).toBe(grpcMetadata.version)
        const sessionBase64Decoded = metadata?.get(grpcMetadataKeys.SESSION)

        expect(sessionBase64Decoded).toBeDefined()
    })
})
