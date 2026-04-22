import * as grpc from '@grpc/grpc-js'
import { Metadata, Server, ServerCredentials, ServerUnaryCall, handleUnaryCall } from '@grpc/grpc-js'
import { cloneDeep, set } from 'lodash'
import { mock } from 'vitest-mock-extended'

import Logger from '@diia-inhouse/diia-logger'
import { ApiError } from '@diia-inhouse/errors'
import { FeatureService } from '@diia-inhouse/features'
import TestKit from '@diia-inhouse/test'
import { ActionVersion, HttpStatusCode } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'

import { ActionExecutor, GrpcServerConfig, GrpcService } from '../../../src'
import { GrpcAction, grpcObjectWithAction, grpcObjectWithActionError, grpcObjectWithStreamAction } from '../../mocks'

vi.mock('@grpc/proto-loader')
vi.mock('@grpc/reflection')
vi.mock('@grpc/grpc-js', async (importOriginal) => {
    const original = await importOriginal<typeof import('@grpc/grpc-js')>()

    return {
        ...original,
        Server: class ServerMock {
            bindAsync(): unknown {
                return vi.fn()
            }

            tryShutdown(): unknown {
                return vi.fn()
            }

            addService(): unknown {
                return vi.fn()
            }

            forceShutdown(): unknown {
                return vi.fn()
            }
        },
    }
})

const systemServiceName = 'service-name'
const serviceName = 'ServiceName'

describe(`${GrpcService.name}`, () => {
    const testKit = new TestKit()
    const actionExecutor = mock<ActionExecutor>()
    const featureFlag = mock<FeatureService>({ isEnabled: vi.fn() })
    const logger = mock<Logger>({ info: vi.fn() })
    const config: GrpcServerConfig = {
        isEnabled: true,
        port: 5000,
        services: ['ua.gov.diia.publicservice.service-with-action'],
        isReflectionEnabled: true,
        maxReceiveMessageLength: 1024 * 1024 * 4,
    }

    describe(`method ${GrpcService.prototype.onInit.name}`, () => {
        it('should not start GRPC server', async () => {
            vi.spyOn(logger, 'info').mockImplementation(() => {})

            const grpcService = new GrpcService(
                { grpcServer: { ...config, isEnabled: false } },
                [],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            await grpcService.onInit()

            expect(logger.info).toHaveBeenCalledWith('grpc server disabled')
        })

        it('should start GRPC server', async () => {
            const grpcService = new GrpcService(
                { grpcServer: { ...config, services: [] } },
                [],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            vi.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce({ ...grpcObjectWithAction, ...grpcObjectWithActionError })
            vi.spyOn(Server.prototype, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })

            expect(await grpcService.onInit()).toEqual({ serverPort: expect.any(Number) })
        })

        it('should throw error if originalName was not provided for method', async () => {
            const grpcService = new GrpcService(
                { grpcServer: config },
                [],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            vi.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(
                set(cloneDeep(grpcObjectWithAction), 'service-with-action.service.action.originalName', ''),
            )
            vi.spyOn(Server.prototype, 'addService').mockReturnThis()
            vi.spyOn(Server.prototype, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })

            await expect(grpcService.onInit()).rejects.toThrow(new Error('Original name in method object is undefined'))
        })

        it('should throw error if GRPC server was unable to start', async () => {
            const grpcService = new GrpcService(
                { grpcServer: { ...config, services: [] } },
                [],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            vi.spyOn(Server.prototype, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(new Error('Mocked error'), 5000)
            })

            await expect(grpcService.onInit()).rejects.toThrow('Mocked error')
        })

        it('should throw error if no action of specified version was found', async () => {
            const actionVersion = ActionVersion.V2
            const headers = testKit.session.getHeaders({ actionVersion })
            const session = testKit.session.getUserSession()
            const sessionBase64 = utils.encodeObjectToBase64(session)
            const handlers: handleUnaryCall<unknown, unknown>[] = []
            const grpcService = new GrpcService(
                { grpcServer: config },
                [new GrpcAction()],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            vi.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectWithAction)
            vi.spyOn(Server.prototype, 'addService').mockImplementation((_service, implementation) => {
                for (const key in implementation) {
                    handlers.push(implementation[key] as handleUnaryCall<unknown, unknown>)
                }
            })
            vi.spyOn(Server.prototype, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })

            await grpcService.onInit()

            await handlers[0](
                {
                    metadata: Metadata.fromHttp2Headers({ ...headers, session: sessionBase64 }),
                    request: { param: `${HttpStatusCode}` },
                    sendMetadata: () => {},
                } as unknown as ServerUnaryCall<{ params: { param: string } }, string>,
                (err: unknown, resp) => {
                    expect((err as { message: string; code: number }).message).toBe(
                        `Configuration error: action not found for version ${actionVersion}`,
                    )
                    expect((err as { message: string; code: number }).code).toBe(12)
                    expect(resp).toBeNull()
                },
            )
        })

        it('should throw error if no action file was found', async () => {
            const grpcService = new GrpcService(
                { grpcServer: config },
                [],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            vi.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectWithAction)

            await expect(grpcService.onInit()).rejects.toThrow('Unable to find any action for action')
        })
    })

    describe(`method ${GrpcService.prototype.onDestroy.name}`, () => {
        it('should shutdown GRPC server', async () => {
            const grpcService = new GrpcService(
                { grpcServer: { ...config, services: [] } },
                [],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            vi.spyOn(Server.prototype, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })
            vi.spyOn(Server.prototype, 'tryShutdown').mockImplementationOnce((cb) => {
                cb()
            })

            await grpcService.onInit()

            const result = await grpcService.onDestroy()

            expect(result).toBeUndefined()
            expect(Server.prototype.tryShutdown).toHaveBeenCalled()
        })

        it('should reject with error', async () => {
            const grpcService = new GrpcService(
                { grpcServer: { ...config, services: [] } },
                [],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            vi.spyOn(Server.prototype, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })
            vi.spyOn(Server.prototype, 'tryShutdown').mockImplementationOnce((cb) => {
                cb(new Error('Mocked error'))
            })

            await grpcService.onInit()

            await expect(() => grpcService.onDestroy()).rejects.toThrow(new Error('Mocked error'))
        })
    })

    describe(`method ${GrpcService.prototype.onHealthCheck.name}`, () => {
        it('should have status UNKNOWN by default', async () => {
            const grpcService = new GrpcService(
                { grpcServer: { ...config, services: [] } },
                [],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            await expect(grpcService.onHealthCheck()).resolves.toEqual({
                status: HttpStatusCode.SERVICE_UNAVAILABLE,
                details: { grpcServer: 'UNKNOWN' },
            })
        })
    })

    describe('stream grpc implementation', () => {
        describe('handler execution failed', () => {
            it('should not end stream when action execution fails and feature flag is disabled', async () => {
                // Arrange
                actionExecutor.execute.mockRejectedValueOnce(new ApiError('forbidden', HttpStatusCode.FORBIDDEN))

                const handlers: ((input: unknown) => Promise<void>)[] = []
                const streamConfig: GrpcServerConfig = {
                    ...config,
                    services: ['service-with-stream-action'],
                }

                const grpcService = new GrpcService(
                    { grpcServer: streamConfig },
                    [new GrpcAction()],
                    logger,
                    actionExecutor,
                    systemServiceName,
                    serviceName,
                    undefined,
                    featureFlag,
                )

                featureFlag.isEnabled.mockReturnValueOnce(false)

                vi.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectWithStreamAction)
                vi.spyOn(Server.prototype, 'addService').mockImplementation((_service, implementation) => {
                    for (const key in implementation) {
                        handlers.push(implementation[key] as (input: unknown) => Promise<void>)
                    }
                })
                vi.spyOn(Server.prototype, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                    cb(null, 5000)
                })

                await grpcService.onInit()

                const listeners = new Map<string, (...args: unknown[]) => unknown>()
                const input = {
                    metadata: new Metadata(),
                    request: undefined,
                    addListener: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
                        listeners.set(event, handler)

                        return input
                    }),
                    prependListener: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
                        listeners.set(event, handler)

                        return input
                    }),
                    write: vi.fn(),
                    end: vi.fn(),
                    emit: vi.fn(),
                    destroy: vi.fn(),
                }

                // Act
                await handlers[0](input)

                const dataListener = listeners.get('data')

                await dataListener?.({ payload: 'x' })

                // Assert
                expect(dataListener).toBeDefined()
                expect(input.end).not.toHaveBeenCalled()
            })

            it('should end stream with rpc error when action execution fails and feature flag is enabled', async () => {
                // Arrange
                actionExecutor.execute.mockRejectedValueOnce(new ApiError('forbidden', HttpStatusCode.FORBIDDEN))

                const handlers: ((input: unknown) => Promise<void>)[] = []
                const streamConfig: GrpcServerConfig = {
                    ...config,
                    services: ['service-with-stream-action'],
                }

                const grpcService = new GrpcService(
                    { grpcServer: streamConfig },
                    [new GrpcAction()],
                    logger,
                    actionExecutor,
                    systemServiceName,
                    serviceName,
                    undefined,
                    featureFlag,
                )

                featureFlag.isEnabled.mockReturnValueOnce(true)

                vi.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectWithStreamAction)
                vi.spyOn(Server.prototype, 'addService').mockImplementation((_service, implementation) => {
                    for (const key in implementation) {
                        handlers.push(implementation[key] as (input: unknown) => Promise<void>)
                    }
                })
                vi.spyOn(Server.prototype, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                    cb(null, 5000)
                })

                await grpcService.onInit()

                const listeners = new Map<string, (...args: unknown[]) => unknown>()
                const input = {
                    metadata: new Metadata(),
                    request: undefined,
                    addListener: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
                        listeners.set(event, handler)

                        return input
                    }),
                    prependListener: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
                        listeners.set(event, handler)

                        return input
                    }),
                    write: vi.fn(),
                    end: vi.fn(),
                    emit: vi.fn(),
                    destroy: vi.fn(),
                }

                // Act
                await handlers[0](input)

                const dataListener = listeners.get('data')

                await dataListener?.({ payload: 'x' })

                // Assert
                expect(dataListener).toBeDefined()
                expect(input.end).toHaveBeenCalledTimes(1)
                expect(input.end).toHaveBeenCalledWith(
                    expect.objectContaining({
                        code: grpc.status.PERMISSION_DENIED,
                        details: 'forbidden',
                    }),
                )
            })
        })
    })
})
