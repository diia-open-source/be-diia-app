import { CallOptions, ClientMiddleware, ClientMiddlewareCall, TsProtoServiceDefinition } from 'nice-grpc'
import { mock, mockDeep } from 'vitest-mock-extended'

import { DiiaLogger } from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import TestKit from '@diia-inhouse/test'
import { ActionVersion, grpcMetadataKeys } from '@diia-inhouse/types'

import { GrpcClientFactory, clientCallOptions } from '../../../src/grpc'
import { BaseConfig } from '../../../src/interfaces'

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

/* oxlint-disable typescript/await-thenable, jest/no-standalone-expect */
vi.mock('nice-grpc', async (importOriginal) => {
    const originalModule = await importOriginal<typeof import('nice-grpc')>()

    return {
        __esModule: true,
        ...originalModule,
        createChannel: vi.fn<() => unknown>(),
        ChannelCredentials: {
            createInsecure: vi.fn<() => unknown>(),
        },
        createClientFactory: (): unknown => ({
            use: (loggingMiddleware: ClientMiddleware): object => ({
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
/* oxlint-enable typescript/await-thenable, jest/no-standalone-expect */

describe('grpcClientFactory', () => {
    const serviceName = 'Auth'
    const logger = mock<DiiaLogger>()
    const metrics = mockDeep<MetricsService>()

    const config = mock<BaseConfig>()

    const grpcClientFactory = new GrpcClientFactory(config, serviceName, logger, metrics)

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
