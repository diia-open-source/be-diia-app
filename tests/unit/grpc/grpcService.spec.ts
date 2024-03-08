import { AsyncLocalStorage } from 'async_hooks'

import * as grpc from '@grpc/grpc-js'
import { Metadata, Server, ServerCredentials, ServerUnaryCall, handleUnaryCall } from '@grpc/grpc-js'
import { Redis } from 'ioredis'
import { cloneDeep, get, set } from 'lodash'
import { RedlockMutex } from 'redis-semaphore'

import Logger from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { RedlockService } from '@diia-inhouse/redis'
import TestKit, { mockClass, mockInstance } from '@diia-inhouse/test'
import { ActionVersion, AlsData, GrpcStatusCode, HttpStatusCode, LogData, SessionType } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'
import { AppValidator } from '@diia-inhouse/validators'

import { GrpcService } from '../../../src'
import {
    GrpcAction,
    GrpcActionError,
    GrpcActionRedlock,
    grpcObjectActionRedlock,
    grpcObjectWithAction,
    grpcObjectWithActionError,
} from '../../mocks'

jest.mock('@grpc/proto-loader')
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
    const validator = mockInstance(AppValidator)
    const logger = mockInstance(Logger)
    const envService = new EnvService(logger)
    const asyncLocalStorage = new AsyncLocalStorage<AlsData>()
    const redlock = mockInstance(RedlockService)
    const MutexMock = mockClass(RedlockMutex)
    const metrics = mockInstance(MetricsService, {
        totalRequestMetric: {
            increment: jest.fn(),
        },
        totalTimerMetric: {
            observeSeconds: jest.fn(),
        },
        responseTotalTimerMetric: {
            observeSeconds: jest.fn(),
        },
    })

    const serviceName = 'File'

    describe(`method ${GrpcService.prototype.onInit.name}`, () => {
        beforeEach(() => {
            process.env.GRPC_SERVER_ENABLED = 'true'
            process.env.GRPC_SERVICES = '["ua.gov.diia.publicservice.service-with-action"]'
        })

        it('should not start GRPC server', async () => {
            process.env.GRPC_SERVER_ENABLED = 'false'

            const loggerSpy = jest.spyOn(logger, 'info')

            const grpcService = new GrpcService(envService, [], logger, validator, asyncLocalStorage, serviceName, metrics, redlock)

            await grpcService.onInit()

            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            expect(loggerSpy).toHaveBeenCalledWith('grpc server disabled')
            expect(grpcServer.start).not.toHaveBeenCalled()
        })

        it('should start GRPC server', async () => {
            process.env.GRPC_SERVICES = '[]'

            const grpcService = new GrpcService(envService, [], logger, validator, asyncLocalStorage, serviceName, metrics, redlock)

            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            jest.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce({ ...grpcObjectWithAction, ...grpcObjectWithActionError })
            jest.spyOn(grpcServer, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })

            await grpcService.onInit()

            expect(grpcServer.start).toHaveBeenCalled()
        })

        it('should start GRPC server with services', async () => {
            process.env.GRPC_SERVICES =
                '["ua.gov.diia.publicservice.service-with-action", "ua.gov.diia.publicservice.service-with-action-error"]'

            const headers = testKit.session.getHeaders({ actionVersion: ActionVersion.V1 })
            const session = testKit.session.getUserSession()
            const sessionBase64 = utils.encodeObjectToBase64(session)
            const handlers: handleUnaryCall<unknown, unknown>[] = []
            const grpcService = new GrpcService(
                envService,
                [new GrpcAction(), new GrpcActionError()],
                logger,
                validator,
                asyncLocalStorage,
                serviceName,
                metrics,
                redlock,
            )
            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            jest.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce({ ...grpcObjectWithAction, ...grpcObjectWithActionError })
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
                    request: { param: 'mocked param' },
                }),
                (err, resp) => {
                    expect(err).toBeNull()
                    expect(resp).toBe('mocked param')
                },
            )

            await handlers[1](
                <ServerUnaryCall<{ params: { param: string } }, string>>(<unknown>{
                    metadata: Metadata.fromHttp2Headers({ ...headers, session: sessionBase64 }),
                    request: {},
                }),
                (err: unknown, resp) => {
                    expect((<{ message: string }>err).message).toBe('Mocked error')
                    expect(resp).toBeNull()
                },
            )

            expect(grpcServer.addService).toHaveBeenCalledTimes(2)
            expect(grpcServer.start).toHaveBeenCalled()
        })

        it.each([
            ['BAD_REQUEST error was thrown', HttpStatusCode.BAD_REQUEST, GrpcStatusCode.INVALID_ARGUMENT, {}],
            ['UNAUTHORIZED error was thrown', HttpStatusCode.UNAUTHORIZED, GrpcStatusCode.UNAUTHENTICATED, {}],
            ['FORBIDDEN error was thrown', HttpStatusCode.FORBIDDEN, GrpcStatusCode.PERMISSION_DENIED, {}],
            ['NOT_FOUND error was thrown', HttpStatusCode.NOT_FOUND, GrpcStatusCode.NOT_FOUND, {}],
            ['NOT_FOUND error was thrown with process code', HttpStatusCode.NOT_FOUND, GrpcStatusCode.NOT_FOUND, { processCode: 764301 }],
            ['TOO_MANY_REQUESTS error was thrown', HttpStatusCode.TOO_MANY_REQUESTS, GrpcStatusCode.RESOURCE_EXHAUSTED, {}],
            ['BAD_GATEWAY error was thrown', HttpStatusCode.BAD_GATEWAY, GrpcStatusCode.UNAVAILABLE, {}],
            ['SERVICE_UNAVAILABLE error was thrown', HttpStatusCode.SERVICE_UNAVAILABLE, GrpcStatusCode.UNAVAILABLE, {}],
            ['GATEWAY_TIMEOUT error was thrown', HttpStatusCode.GATEWAY_TIMEOUT, GrpcStatusCode.DEADLINE_EXCEEDED, {}],
            ['INTERNAL_SERVER_ERROR error was thrown', HttpStatusCode.INTERNAL_SERVER_ERROR, GrpcStatusCode.INTERNAL, {}],
        ])('should throw rpc error if %s', async (_msg, httpStatusCode, rpcErrorCode, errorMetadata: { processCode?: number }) => {
            process.env.GRPC_SERVICES = '["ua.gov.diia.publicservice.service-with-action-error"]'

            const { processCode } = errorMetadata
            const headers = testKit.session.getHeaders({ actionVersion: ActionVersion.V1 })
            const session = testKit.session.getUserSession()
            const sessionBase64 = utils.encodeObjectToBase64(session)
            const handlers: handleUnaryCall<unknown, unknown>[] = []
            const grpcService = new GrpcService(
                envService,
                [new GrpcActionError()],
                logger,
                validator,
                asyncLocalStorage,
                serviceName,
                metrics,
                redlock,
            )
            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            jest.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectWithActionError)
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
                    request: { param: `${httpStatusCode}`, processCode },
                }),
                (err: unknown, resp) => {
                    expect((<{ message: string }>err).message).toBe('Mocked error')
                    expect((<{ code: number }>err).code).toBe(rpcErrorCode)
                    expect(resp).toBeNull()
                },
            )
        })

        it.each([
            [SessionType.PortalUser, 'user.identifier', 'userIdentifier'],
            [SessionType.CabinetUser, 'user.identifier', 'userIdentifier'],
            [SessionType.EResidentApplicant, 'user.identifier', 'userIdentifier'],
            [SessionType.EResident, 'user.identifier', 'userIdentifier'],
            [SessionType.User, 'user.identifier', 'userIdentifier'],
            [SessionType.ServiceUser, 'serviceUser.login', 'sessionOwnerId'],
            [SessionType.Partner, 'partner._id', 'sessionOwnerId'],
            [SessionType.Acquirer, 'acquirer._id', 'sessionOwnerId'],
            [SessionType.Temporary, 'temporary.mobileUid', 'sessionOwnerId'],
            [SessionType.ServiceEntrance, 'entrance.acquirerId', 'sessionOwnerId'],
        ])('should prepare async local storage log data for %s session type', async (sessionType, getPath, setKey) => {
            const session = testKit.session.getSessionBySessionType(sessionType)
            const { platformType, token, ...headers } = testKit.session.getHeaders({ actionVersion: ActionVersion.V1 })
            const expected: LogData = {
                sessionType,
                ...headers,
                [setKey]: get(session, getPath).toString(),
            }
            const sessionBase64 = utils.encodeObjectToBase64(session)
            const handlers: handleUnaryCall<unknown, unknown>[] = []
            const grpcService = new GrpcService(
                envService,
                [new GrpcAction()],
                logger,
                validator,
                asyncLocalStorage,
                serviceName,
                metrics,
                redlock,
            )
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

            const prepareContextSpy = jest.spyOn(logger, 'prepareContext')

            await grpcService.onInit()

            await handlers[0](
                <ServerUnaryCall<{ params: { param: string } }, string>>(<unknown>{
                    metadata: Metadata.fromHttp2Headers({ ...headers, session: sessionBase64 }),
                    request: { param: 'mocked param' },
                }),
                () => {},
            )

            expect(prepareContextSpy).toHaveBeenCalledWith(expected)
        })

        it(`should prepare async local storage log data for ${SessionType.None} session type`, async () => {
            const { platformType, token, ...headers } = testKit.session.getHeaders({ actionVersion: ActionVersion.V1 })
            const expected: LogData = { ...headers, sessionType: SessionType.None }
            const handlers: handleUnaryCall<unknown, unknown>[] = []
            const grpcService = new GrpcService(
                envService,
                [new GrpcAction()],
                logger,
                validator,
                asyncLocalStorage,
                serviceName,
                metrics,
                redlock,
            )
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

            const prepareContextSpy = jest.spyOn(logger, 'prepareContext')

            await grpcService.onInit()

            await handlers[0](
                <ServerUnaryCall<{ params: { param: string } }, string>>(<unknown>{
                    metadata: Metadata.fromHttp2Headers({ ...headers }),
                    request: { param: 'mocked param' },
                }),
                () => {},
            )

            expect(prepareContextSpy).toHaveBeenCalledWith(expected)
        })

        it('should lock resource', async () => {
            process.env.GRPC_SERVICES = '["ua.gov.diia.publicservice.service-with-action-redlock"]'

            const headers = testKit.session.getHeaders({ actionVersion: ActionVersion.V1 })
            const session = testKit.session.getUserSession()
            const sessionBase64 = utils.encodeObjectToBase64(session)
            const handlers: handleUnaryCall<unknown, unknown>[] = []
            const grpcService = new GrpcService(
                envService,
                [new GrpcActionRedlock()],
                logger,
                validator,
                asyncLocalStorage,
                serviceName,
                metrics,
                redlock,
            )
            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances
            const lockResource = `action-redlock.action-redlock-${headers.mobileUid}`
            const mutex = new MutexMock([<Redis>{}], lockResource)

            jest.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectActionRedlock)
            jest.spyOn(grpcServer, 'addService').mockImplementation((_service, implementation) => {
                for (const key in implementation) {
                    handlers.push(<handleUnaryCall<unknown, unknown>>implementation[key])
                }
            })
            jest.spyOn(grpcServer, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })

            const lockSpy = jest.spyOn(redlock, 'lock').mockResolvedValueOnce(mutex)

            await grpcService.onInit()

            await handlers[0](
                <ServerUnaryCall<{ params: { param: string } }, string>>(<unknown>{
                    metadata: Metadata.fromHttp2Headers({ ...headers, session: sessionBase64 }),
                    request: {},
                }),
                (err, resp) => {
                    expect(err).toBeNull()
                    expect(resp).toBe(true)
                },
            )

            expect(lockSpy).toHaveBeenCalledWith(lockResource, 30000)
            expect(mutex.release).toHaveBeenCalled()
        })

        it('should throw error on unexpected session type', async () => {
            const sessionType = <SessionType>'unexpected-session-type'
            const session = {
                ...testKit.session.getUserSession(),
                sessionType,
            }
            const { platformType, token, ...headers } = testKit.session.getHeaders({ actionVersion: ActionVersion.V1 })
            const sessionBase64 = utils.encodeObjectToBase64(session)
            const handlers: handleUnaryCall<unknown, unknown>[] = []
            const grpcService = new GrpcService(
                envService,
                [new GrpcAction()],
                logger,
                validator,
                asyncLocalStorage,
                serviceName,
                metrics,
                redlock,
            )
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
                    request: { param: 'mocked param' },
                }),
                (err) => {
                    expect((<{ message: string; code: number }>err).message).toBe(`Unexpected sessionType: ${sessionType}`)
                    expect((<{ message: string; code: number }>err).code).toBe(GrpcStatusCode.INTERNAL)
                },
            )
        })

        it('should throw error if originalName was not provided for method', async () => {
            const grpcService = new GrpcService(envService, [], logger, validator, asyncLocalStorage, serviceName, metrics, redlock)

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
            process.env.GRPC_SERVICES = '[]'

            const grpcService = new GrpcService(envService, [], logger, validator, asyncLocalStorage, serviceName, metrics, redlock)

            const [grpcServer] = (<jest.MockedClass<typeof Server>>Server).mock.instances

            jest.spyOn(grpcServer, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(new Error('Mocked error'), 5000)
            })

            await expect(async () => await grpcService.onInit()).rejects.toThrow('Unable to start grpc service Error: Mocked error')
        })

        it('should throw error if no action of specified version was found', async () => {
            const actionVersion = ActionVersion.V2
            const headers = testKit.session.getHeaders({ actionVersion })
            const session = testKit.session.getUserSession()
            const sessionBase64 = utils.encodeObjectToBase64(session)
            const handlers: handleUnaryCall<unknown, unknown>[] = []
            const grpcService = new GrpcService(
                envService,
                [new GrpcAction()],
                logger,
                validator,
                asyncLocalStorage,
                serviceName,
                metrics,
                redlock,
            )
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
            const grpcService = new GrpcService(envService, [], logger, validator, asyncLocalStorage, serviceName, metrics, redlock)

            jest.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectWithAction)

            await expect(async () => await grpcService.onInit()).rejects.toThrow('Unable to find any action for action')
        })
    })

    describe(`method ${GrpcService.prototype.onDestroy.name}`, () => {
        beforeEach(() => {
            process.env.GRPC_SERVER_ENABLED = 'true'
            process.env.GRPC_SERVICES = '[]'
        })

        it('should shutdown GRPC server', async () => {
            const grpcService = new GrpcService(envService, [], logger, validator, asyncLocalStorage, serviceName, metrics, redlock)

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
            const grpcService = new GrpcService(envService, [], logger, validator, asyncLocalStorage, serviceName, metrics, redlock)

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
            process.env.GRPC_SERVICES = '[]'

            const grpcService = new GrpcService(envService, [], logger, validator, asyncLocalStorage, serviceName, metrics, redlock)

            await expect(grpcService.onHealthCheck()).resolves.toEqual({
                status: HttpStatusCode.SERVICE_UNAVAILABLE,
                details: { grpcServer: 'UNKNOWN' },
            })
        })
    })
})
