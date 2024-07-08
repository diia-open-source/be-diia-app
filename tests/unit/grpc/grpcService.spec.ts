import * as grpc from '@grpc/grpc-js'
import { Metadata, Server, ServerCredentials, ServerUnaryCall, handleUnaryCall } from '@grpc/grpc-js'
import { cloneDeep, set } from 'lodash'

import Logger from '@diia-inhouse/diia-logger'
import TestKit, { mockInstance } from '@diia-inhouse/test'
import { ActionVersion, HttpStatusCode } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'

import { ActionExecutor, GrpcServerConfig, GrpcService } from '../../../src'
import { GrpcAction, grpcObjectWithAction, grpcObjectWithActionError } from '../../mocks'

jest.mock('@grpc/proto-loader')
jest.mock('@grpc/reflection')
jest.mock('@grpc/grpc-js', () => {
    const mocked = <Record<string, unknown>>jest.createMockFromModule('@grpc/grpc-js')
    const { Metadata: actualMetadata } = jest.requireActual('@grpc/grpc-js')

    return {
        ...mocked,
        Metadata: actualMetadata,
    }
})

describe(`${GrpcService.name}`, () => {
    const testKit = new TestKit()
    const actionExecutor = mockInstance(ActionExecutor)
    const logger = mockInstance(Logger)
    const config: GrpcServerConfig = {
        isEnabled: true,
        port: 5000,
        services: ['ua.gov.diia.publicservice.service-with-action'],
        isReflectionEnabled: true,
        maxReceiveMessageLength: 1024 * 1024 * 4,
    }

    describe(`method ${GrpcService.prototype.onInit.name}`, () => {
        it('should not start GRPC server', async () => {
            const loggerSpy = jest.spyOn(logger, 'info')

            const grpcService = new GrpcService({ grpcServer: { ...config, isEnabled: false } }, [], logger, actionExecutor)

            await grpcService.onInit()

            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            expect(loggerSpy).toHaveBeenCalledWith('grpc server disabled')
            expect(grpcServer).toBeUndefined()
        })

        it('should start GRPC server', async () => {
            const grpcService = new GrpcService({ grpcServer: { ...config, services: [] } }, [], logger, actionExecutor)

            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            jest.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce({ ...grpcObjectWithAction, ...grpcObjectWithActionError })
            jest.spyOn(grpcServer, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })

            expect(await grpcService.onInit()).toBeUndefined()
        })

        it('should throw error if originalName was not provided for method', async () => {
            const grpcService = new GrpcService({ grpcServer: config }, [], logger, actionExecutor)

            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            jest.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(
                set(cloneDeep(grpcObjectWithAction), 'service-with-action.service.action.originalName', ''),
            )
            jest.spyOn(grpcServer, 'addService').mockReturnThis()
            jest.spyOn(grpcServer, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })

            await expect(async () => await grpcService.onInit()).rejects.toThrow(new Error('Original name in method object is undefined'))
        })

        it('should throw error if GRPC server was unable to start', async () => {
            const grpcService = new GrpcService({ grpcServer: { ...config, services: [] } }, [], logger, actionExecutor)

            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            jest.spyOn(grpcServer, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(new Error('Mocked error'), 5000)
            })

            await expect(async () => await grpcService.onInit()).rejects.toThrow('Mocked error')
        })

        it('should throw error if no action of specified version was found', async () => {
            const actionVersion = ActionVersion.V2
            const headers = testKit.session.getHeaders({ actionVersion })
            const session = testKit.session.getUserSession()
            const sessionBase64 = utils.encodeObjectToBase64(session)
            const handlers: handleUnaryCall<unknown, unknown>[] = []
            const grpcService = new GrpcService({ grpcServer: config }, [new GrpcAction()], logger, actionExecutor)
            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            jest.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectWithAction)
            jest.spyOn(grpcServer, 'addService').mockImplementation((_service, implementation) => {
                for (const key in implementation) {
                    handlers.push(<handleUnaryCall<unknown, unknown>>implementation[key])
                }
            })
            jest.spyOn(grpcServer, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })

            await grpcService.onInit()

            await handlers[0](
                <ServerUnaryCall<{ params: { param: string } }, string>>(<unknown>{
                    metadata: Metadata.fromHttp2Headers({ ...headers, session: sessionBase64 }),
                    request: { param: `${HttpStatusCode}` },
                }),
                (err: unknown, resp) => {
                    expect((<{ message: string; code: number }>err).message).toBe(
                        `Configuration error: action not found for version ${actionVersion}`,
                    )
                    expect((<{ message: string; code: number }>err).code).toBe(12)
                    expect(resp).toBeNull()
                },
            )
        })

        it('should throw error if no action file was found', async () => {
            const grpcService = new GrpcService({ grpcServer: config }, [], logger, actionExecutor)

            jest.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectWithAction)

            await expect(async () => await grpcService.onInit()).rejects.toThrow('Unable to find any action for action')
        })
    })

    describe(`method ${GrpcService.prototype.onDestroy.name}`, () => {
        it('should shutdown GRPC server', async () => {
            const grpcService = new GrpcService({ grpcServer: { ...config, services: [] } }, [], logger, actionExecutor)

            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            jest.spyOn(grpcServer, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })
            jest.spyOn(grpcServer, 'tryShutdown').mockImplementationOnce((cb) => {
                cb()
            })

            await grpcService.onInit()

            const result = await grpcService.onDestroy()

            expect(result).toBeUndefined()
            expect(grpcServer.tryShutdown).toHaveBeenCalled()
        })

        it('should reject with error', async () => {
            const grpcService = new GrpcService({ grpcServer: { ...config, services: [] } }, [], logger, actionExecutor)

            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            jest.spyOn(grpcServer, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })
            jest.spyOn(grpcServer, 'tryShutdown').mockImplementationOnce((cb) => {
                cb(new Error('Mocked error'))
            })

            await grpcService.onInit()

            await expect(() => grpcService.onDestroy()).rejects.toThrow(new Error('Mocked error'))
        })
    })

    describe(`method ${GrpcService.prototype.onHealthCheck.name}`, () => {
        it('should have status UNKNOWN by default', async () => {
            const grpcService = new GrpcService({ grpcServer: { ...config, services: [] } }, [], logger, actionExecutor)

            await expect(grpcService.onHealthCheck()).resolves.toEqual({
                status: HttpStatusCode.SERVICE_UNAVAILABLE,
                details: { grpcServer: 'UNKNOWN' },
            })
        })
    })
})
