import * as grpc from '@grpc/grpc-js'
import { Metadata, Server, ServerCredentials, ServerUnaryCall, handleUnaryCall } from '@grpc/grpc-js'
import { cloneDeep, set } from 'lodash'
import { mock } from 'vitest-mock-extended'

import Logger from '@diia-inhouse/diia-logger'
import { ApiError } from '@diia-inhouse/errors'
import { FeatureService } from '@diia-inhouse/features'
import TestKit from '@diia-inhouse/test'
import { ActionVersion, HttpStatusCode, grpcMetadataKeys } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'

import { ActionExecutor, GrpcServerConfig, GrpcService } from '../../../src'
import {
    GrpcAction,
    GrpcStreamChannelAction,
    grpcObjectWithAction,
    grpcObjectWithActionError,
    grpcObjectWithStreamAction,
} from '../../mocks'
import { createStreamInput } from '../../mocks/grpcObject'

vi.mock('@grpc/proto-loader')
vi.mock('@grpc/reflection')
vi.mock('@grpc/grpc-js', async (importOriginal) => {
    const original = await importOriginal<typeof import('@grpc/grpc-js')>()

    return {
        ...original,
        Server: class ServerMock {
            bindAsync(): unknown {
                return vi.fn<() => unknown>()
            }

            tryShutdown(): unknown {
                return vi.fn<() => unknown>()
            }

            addService(): unknown {
                return vi.fn<() => unknown>()
            }

            forceShutdown(): unknown {
                return vi.fn<() => unknown>()
            }
        },
    }
})

const systemServiceName = 'service-name'
const serviceName = 'ServiceName'

describe(GrpcService.name, () => {
    const testKit = new TestKit()
    const actionExecutor = mock<ActionExecutor>()
    // oxlint-disable-next-line vitest/require-mock-type-parameters
    const featureFlag = mock<FeatureService>({ isEnabled: vi.fn() })
    // oxlint-disable-next-line vitest/require-mock-type-parameters
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
            // Arrange
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

            // Act
            await grpcService.onInit()

            // Assert
            expect(logger.info).toHaveBeenCalledWith('grpc server disabled')
        })

        it('should start GRPC server', async () => {
            // Arrange
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

            // Act
            const initResult = await grpcService.onInit()

            // Assert
            expect(initResult).toEqual({ serverPort: expect.any(Number) })
        })

        it('should throw error if originalName was not provided for method', async () => {
            // Arrange
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
            // Arrange
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

            // Act & Assert
            await expect(grpcService.onInit()).rejects.toThrow('Mocked error')
        })

        it('should throw error if no action of specified version was found', async () => {
            // Arrange
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

            // Act & Assert
            handlers[0](
                {
                    metadata: Metadata.fromHttp2Headers({ ...headers, session: sessionBase64 }),
                    request: { param: 'value' },
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
            // Arrange
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

            // Act & Assert
            await expect(grpcService.onInit()).rejects.toThrow('Unable to find any action for action')
        })
    })

    describe(`method ${GrpcService.prototype.onDestroy.name}`, () => {
        it('should shutdown GRPC server', async () => {
            // Arrange
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

            // Act
            const result = await grpcService.onDestroy()

            // Assert
            expect(result).toBeUndefined()
            expect(Server.prototype.tryShutdown).toHaveBeenCalled()
        })

        it('should reject with error', async () => {
            // Arrange
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

            // Act & Assert
            await expect(() => grpcService.onDestroy()).rejects.toThrow(new Error('Mocked error'))
        })

        it('should wait for onConnectionClosed before resolving onDestroy', async () => {
            // Arrange
            let resolveOnConnectionClosed: (() => void) | undefined
            const onConnectionClosedPromise = new Promise<void>((resolve) => {
                resolveOnConnectionClosed = resolve
            })

            const handlers: ((input: unknown) => Promise<void>)[] = []

            const grpcService = new GrpcService(
                { grpcServer: { ...config, services: ['service-with-stream-action'] } },
                [new GrpcStreamChannelAction(onConnectionClosedPromise)],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            vi.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectWithStreamAction)
            vi.spyOn(Server.prototype, 'addService').mockImplementation((_service, implementation) => {
                for (const key in implementation) {
                    handlers.push(implementation[key] as (input: unknown) => Promise<void>)
                }
            })
            vi.spyOn(Server.prototype, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })
            vi.spyOn(Server.prototype, 'tryShutdown').mockImplementationOnce((cb) => {
                cb()
            })

            await grpcService.onInit()

            const { input, listeners } = createStreamInput()

            await handlers[0](input)

            listeners.get('close')?.()

            // Act
            let isOnDestroyResolved = false
            const onDestroyPromise = grpcService.onDestroy().then(() => {
                isOnDestroyResolved = true

                return isOnDestroyResolved
            })

            await Promise.resolve()

            // Assert
            expect(isOnDestroyResolved).toBe(false)

            resolveOnConnectionClosed?.()
            await onDestroyPromise

            expect(isOnDestroyResolved).toBe(true)
            expect(Server.prototype.tryShutdown).toHaveBeenCalledTimes(1)
        })

        it('should close previous stream and resubscribe when duplicate mobileUid connection opens', async () => {
            // Arrange
            const mobileUid = 'duplicate-mobile-uid'
            const handlers: ((input: unknown) => Promise<void>)[] = []
            const streamAction = new GrpcStreamChannelAction()
            const subscribeChannelSpy = vi.spyOn(streamAction, 'subscribeChannel')

            const grpcService = new GrpcService(
                { grpcServer: { ...config, services: ['service-with-stream-action'] } },
                [streamAction],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

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

            const { input: firstInput } = createStreamInput(mobileUid)
            const { input: secondInput } = createStreamInput(mobileUid)

            // Act
            await handlers[0](firstInput)
            const firstStreamId = firstInput.metadata.get(grpcMetadataKeys.STREAM_ID)[0] as string

            await handlers[0](secondInput)

            streamAction.publishTestMessage(mobileUid, { event: 'test' })

            // Assert
            expect(subscribeChannelSpy).toHaveBeenCalledTimes(3)
            expect(secondInput.end).not.toHaveBeenCalled()
            expect(logger.info).toHaveBeenCalledWith(`Closing existing connections by mobileUid ${mobileUid}`, {
                subscriptions: [firstStreamId],
            })
            expect(secondInput.write).toHaveBeenCalledWith({ event: 'test' })
            expect(firstInput.write).not.toHaveBeenCalled()
        })

        it('should continue shutdown when stream close handlers exceed timeout', async () => {
            // Arrange
            vi.useFakeTimers()

            const onConnectionClosedPromise = new Promise<void>(() => {})
            const handlers: ((input: unknown) => Promise<void>)[] = []
            const streamsCloseTimeoutMs = 100

            const grpcService = new GrpcService(
                {
                    grpcServer: {
                        ...config,
                        services: ['service-with-stream-action'],
                        streamsCloseTimeoutMs,
                    },
                },
                [new GrpcStreamChannelAction(onConnectionClosedPromise)],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            vi.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectWithStreamAction)
            vi.spyOn(Server.prototype, 'addService').mockImplementation((_service, implementation) => {
                for (const key in implementation) {
                    handlers.push(implementation[key] as (input: unknown) => Promise<void>)
                }
            })
            vi.spyOn(Server.prototype, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })
            vi.spyOn(Server.prototype, 'tryShutdown').mockImplementationOnce((cb) => {
                cb()
            })

            await grpcService.onInit()

            const { input, listeners } = createStreamInput()

            await handlers[0](input)

            listeners.get('close')?.()

            // Act
            const onDestroyPromise = grpcService.onDestroy()

            await vi.advanceTimersByTimeAsync(streamsCloseTimeoutMs)
            await onDestroyPromise

            // Assert
            expect(logger.warn).toHaveBeenCalledWith('Timed out waiting for grpc stream close handlers', {
                remainingStreamsSize: 1,
                pendingClosureStreamsSize: 1,
                timeoutMs: streamsCloseTimeoutMs,
            })
            expect(Server.prototype.tryShutdown).toHaveBeenCalledTimes(1)

            vi.useRealTimers()
        })

        it('should wait for async close after connection.end during onDestroy', async () => {
            // Arrange
            let resolveOnConnectionClosed: (() => void) | undefined
            const onConnectionClosedPromise = new Promise<void>((resolve) => {
                resolveOnConnectionClosed = resolve
            })
            const handlers: ((input: unknown) => Promise<void>)[] = []

            const grpcService = new GrpcService(
                { grpcServer: { ...config, services: ['service-with-stream-action'] } },
                [new GrpcStreamChannelAction(onConnectionClosedPromise)],
                logger,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            vi.spyOn(grpc, 'loadPackageDefinition').mockReturnValueOnce(grpcObjectWithStreamAction)
            vi.spyOn(Server.prototype, 'addService').mockImplementation((_service, implementation) => {
                for (const key in implementation) {
                    handlers.push(implementation[key] as (input: unknown) => Promise<void>)
                }
            })
            vi.spyOn(Server.prototype, 'bindAsync').mockImplementationOnce((_port: string, _creds: ServerCredentials, cb) => {
                cb(null, 5000)
            })
            vi.spyOn(Server.prototype, 'tryShutdown').mockImplementationOnce((cb) => {
                cb()
            })

            await grpcService.onInit()

            const { input, listeners } = createStreamInput()

            await handlers[0](input)

            // Simulate grpc-js: connection.end() emits 'close' asynchronously
            input.end.mockImplementation(() => {
                queueMicrotask(() => listeners.get('close')?.())
            })

            // Act
            let isOnDestroyResolved = false
            const onDestroyPromise = grpcService.onDestroy().then(() => {
                isOnDestroyResolved = true

                return
            })

            await Promise.resolve()
            await Promise.resolve()

            // Assert
            expect(isOnDestroyResolved).toBe(false)

            resolveOnConnectionClosed?.()
            await onDestroyPromise

            expect(isOnDestroyResolved).toBe(true)
            expect(Server.prototype.tryShutdown).toHaveBeenCalledTimes(1)
        })
    })

    describe(`method ${GrpcService.prototype.onHealthCheck.name}`, () => {
        it('should have status UNKNOWN by default', async () => {
            // Arrange
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

            // Act
            const healthCheckResult = await grpcService.onHealthCheck()

            // Assert
            expect(healthCheckResult).toEqual({
                status: HttpStatusCode.SERVICE_UNAVAILABLE,
                details: { grpcServer: 'UNKNOWN' },
            })
        })
    })

    describe('stream grpc implementation', () => {
        describe('handler execution error response', () => {
            it('should not end stream when action returns error response and feature flag is enabled', async () => {
                // Arrange
                actionExecutor.execute.mockResolvedValueOnce({ error: 'handler failed' })

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

                const { input, listeners } = createStreamInput()

                // Act
                await handlers[0](input)

                const dataListener = listeners.get('data')

                await dataListener?.({ payload: 'x' })

                // Assert
                expect(dataListener).toBeDefined()
                expect(input.write).not.toHaveBeenCalled()
                expect(input.emit).toHaveBeenCalledTimes(1)
                expect(input.emit).toHaveBeenCalledWith(
                    'error',
                    expect.objectContaining({
                        code: grpc.status.INTERNAL,
                        details: 'handler failed',
                    }),
                )
            })
        })

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

                const { input, listeners } = createStreamInput()

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

                const { input, listeners } = createStreamInput()

                // Act
                await handlers[0](input)

                const dataListener = listeners.get('data')

                await dataListener?.({ payload: 'x' })

                // Assert
                expect(dataListener).toBeDefined()
                expect(input.emit).toHaveBeenCalledTimes(1)
                expect(input.emit).toHaveBeenCalledWith(
                    'error',
                    expect.objectContaining({
                        code: grpc.status.PERMISSION_DENIED,
                        details: 'forbidden',
                    }),
                )
            })

            it('should end stream with rpc error when handler returns error response and feature flag is enabled', async () => {
                // Arrange
                actionExecutor.execute.mockResolvedValueOnce({ error: 'handler failed' })

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

                const { input, listeners } = createStreamInput()

                // Act
                await handlers[0](input)

                const dataListener = listeners.get('data')

                await dataListener?.({ payload: 'x' })

                // Assert
                expect(dataListener).toBeDefined()
                expect(input.write).not.toHaveBeenCalled()
                expect(input.emit).toHaveBeenCalledTimes(1)
                expect(input.emit).toHaveBeenCalledWith(
                    'error',
                    expect.objectContaining({
                        code: grpc.status.INTERNAL,
                        details: 'handler failed',
                    }),
                )
            })
        })

        describe('handler execution success', () => {
            it('should not end stream when action execution success and feature flag is disabled', async () => {
                // Arrange
                actionExecutor.execute.mockResolvedValueOnce({ result: 'ok' })

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

                const { input, listeners } = createStreamInput()

                // Act
                await handlers[0](input)

                const dataListener = listeners.get('data')

                await dataListener?.({ payload: 'x' })

                // Assert
                expect(dataListener).toBeDefined()
                expect(input.write).toHaveBeenCalledWith({ result: 'ok' })
                expect(input.end).not.toHaveBeenCalled()
                expect(input.emit).not.toHaveBeenCalledWith('error', expect.anything())
            })

            it('should not end stream when action execution success and feature flag is enabled', async () => {
                // Arrange
                actionExecutor.execute.mockResolvedValueOnce({ result: 'ok' })

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

                const { input, listeners } = createStreamInput()

                await grpcService.onInit()

                // Act
                await handlers[0](input)

                const dataListener = listeners.get('data')

                await dataListener?.({ payload: 'x' })

                // Assert
                expect(dataListener).toBeDefined()
                expect(input.write).toHaveBeenCalledWith({ result: 'ok' })
                expect(input.end).not.toHaveBeenCalled()
                expect(input.emit).not.toHaveBeenCalledWith('error', expect.anything())
            })
        })
    })
})
