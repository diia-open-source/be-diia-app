import * as grpc from '@grpc/grpc-js'
import { Server, ServerCredentials } from '@grpc/grpc-js'
import { load } from '@grpc/proto-loader'
import { mock } from 'vitest-mock-extended'

import Logger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { FeatureService } from '@diia-inhouse/features'
import { HttpStatusCode } from '@diia-inhouse/types'

import { ActionExecutor, GrpcServerConfig, GrpcService } from '../../../src'
import { GrpcStreamChannelAction, grpcObjectWithAction, grpcObjectWithStreamAction } from '../../mocks'
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
    const actionExecutor = mock<ActionExecutor>()
    const envService = mock<EnvService>({ isProd: vi.fn<() => boolean>() })
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

    beforeEach(() => {
        vi.mocked(load).mockResolvedValue({})
    })

    describe(`method ${GrpcService.prototype.onInit.name}`, () => {
        it('should neither start the server nor report it as down when the gRPC server is disabled', async () => {
            // Arrange
            const grpcService = new GrpcService(
                { grpcServer: { ...config, isEnabled: false } },
                [],
                logger,
                envService,
                actionExecutor,
                systemServiceName,
                serviceName,
                undefined,
                featureFlag,
            )

            // Act
            const initResult = await grpcService.onInit()

            // Assert
            expect(initResult).toEqual({})
            await expect(grpcService.onHealthCheck()).resolves.toEqual({
                status: HttpStatusCode.OK,
                details: { grpcServer: 'DISABLED' },
            })
        })

        it('should throw error if GRPC server was unable to start', async () => {
            // Arrange
            const grpcService = new GrpcService(
                { grpcServer: { ...config, services: [] } },
                [],
                logger,
                envService,
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

        it('should throw error if no action file was found', async () => {
            // Arrange
            const grpcService = new GrpcService(
                { grpcServer: config },
                [],
                logger,
                envService,
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
        it('should reject with error', async () => {
            // Arrange
            const grpcService = new GrpcService(
                { grpcServer: { ...config, services: [] } },
                [],
                logger,
                envService,
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
                envService,
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
    })

    describe(`method ${GrpcService.prototype.onHealthCheck.name}`, () => {
        it('should have status UNKNOWN by default', async () => {
            // Arrange
            const grpcService = new GrpcService(
                { grpcServer: { ...config, services: [] } },
                [],
                logger,
                envService,
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
})
