import { CallOptions, ClientMiddleware, ClientMiddlewareCall } from 'nice-grpc'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import TestKit, { mockInstance } from '@diia-inhouse/test'
import { ActionVersion } from '@diia-inhouse/types'

import { GrpcClientFactory, clientCallOptions } from '../../../src/grpc/grpcClient'

const generatorValue = 'generatorResult'

const call = <ClientMiddlewareCall<Request, Response>>(<unknown>{
    method: {
        path: '/test/',
    },
    next: function* () {
        yield generatorValue
    },
    request: '',
})

const options = <CallOptions>(<unknown>{})

const client = {}

jest.mock('nice-grpc', () => {
    const originalModule = jest.requireActual('nice-grpc')

    return {
        __esModule: true,
        ...originalModule,
        createChannel: jest.fn(),
        ChannelCredentials: {
            createInsecure: jest.fn(),
        },
        createClientFactory: (): unknown => ({
            use: (loggingMiddleware: ClientMiddleware) => ({
                use: (metadataMiddleware: ClientMiddleware): object => ({
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
    }
})

describe('grpcClientFactory', () => {
    const serviceName = 'Auth'
    const logger = mockInstance(DiiaLogger)
    const metrics = mockInstance(MetricsService)

    const grpcClientFactory = new GrpcClientFactory(serviceName, logger, metrics)

    it('should create client', async () => {
        const definition = {}
        const serviceAddress = 'ua.gov.diia.publicservice.service-with-action'

        await expect(grpcClientFactory.createGrpcClient(definition, serviceAddress, 'test')).resolves.toStrictEqual(client)
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
        expect(metadata?.get('actionversion')).toBe(grpcMetadata.version)
        const sessionBase64Decoded = metadata?.get('session')

        expect(sessionBase64Decoded).toBeDefined()
    })
})
