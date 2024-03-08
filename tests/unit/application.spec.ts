import { AsyncLocalStorage } from 'async_hooks'

import { AwilixError, asClass, asFunction, asValue } from 'awilix'

import Logger from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { HealthCheck } from '@diia-inhouse/healthcheck'
import { mockClass } from '@diia-inhouse/test'
import { AlsData, SessionType } from '@diia-inhouse/types'
import { AppValidator } from '@diia-inhouse/validators'

import { ActionFactory, Application, BaseConfig, BaseDeps, DepsFactoryFn, MoleculerService } from '../../src'
import { GrpcClientFactory } from '../../src/grpc/grpcClient'
import { configFactory } from '../mocks'

jest.mock('@diia-inhouse/redis', () => {
    const { CacheService, PubSubService, RedlockService, StoreService, ...rest } = jest.requireActual('@diia-inhouse/redis')

    return {
        ...rest,
        CacheService: mockClass(CacheService),
        PubSubService: mockClass(PubSubService),
        RedlockService: mockClass(RedlockService),
        StoreService: mockClass(StoreService),
    }
})

jest.mock('@diia-inhouse/diia-queue', () => {
    const {
        ExternalCommunicator,
        ExternalCommunicatorChannel,
        ExternalEventBus,
        ScheduledTask,
        Queue,
        EventMessageHandler,
        EventMessageValidator,
        EventBus,
        Task,
        QueueConnectionType,
        ...rest
    } = jest.requireActual('@diia-inhouse/diia-queue')

    return {
        ...rest,
        ExternalCommunicator: mockClass(ExternalCommunicator),
        ExternalCommunicatorChannel: mockClass(ExternalCommunicatorChannel),
        ExternalEventBus: mockClass(ExternalEventBus),
        ScheduledTask: mockClass(ScheduledTask),
        Queue: mockClass(Queue),
        EventMessageHandler: mockClass(EventMessageHandler),
        EventMessageValidator: mockClass(EventMessageValidator),
        EventBus: mockClass(EventBus),
        Task: mockClass(Task),
        QueueConnectionType: mockClass(QueueConnectionType),
    }
})

jest.mock('awilix', () => {
    const original = jest.requireActual('awilix')
    let alreadyCalled = false

    return {
        ...original,
        listModules: (): unknown => {
            if (alreadyCalled) {
                return []
            }

            alreadyCalled = true

            return [
                { name: 'auth', path: __dirname + '/dist/actions/auth.ts', opts: null },
                { name: 'user', path: __dirname + '/dist/actions/user.ts', opts: null },
            ]
        },
    }
})

jest.mock(
    `${__dirname}/dist/actions/auth.ts`,
    () => {
        return {
            default: class AuthClass {
                onRegistrationsFinished(): void {}

                getName(): string {
                    return 'AuthClassName'
                }

                getSessionType(): SessionType {
                    return SessionType.User
                }
            },
        }
    },
    { virtual: true },
)
jest.mock(
    `${__dirname}/dist/actions/user.ts`,
    () => {
        return {
            default: class UserClass {
                onInit(): void {}

                getName(): string {
                    return 'UserClassName'
                }

                getSessionType(): SessionType {
                    return SessionType.User
                }
            },
        }
    },
    { virtual: true },
)

describe(`${Application.constructor.name}`, () => {
    const serviceName = 'Auth'

    const AsyncLocalStorageMock = mockClass(AsyncLocalStorage)
    const asyncLocalStorage = new AsyncLocalStorageMock<AlsData>()

    const MockedLogger = mockClass(Logger)
    const logger: Logger = new MockedLogger()

    describe(`method ${Application.prototype.initialize.name}`, () => {
        it('should successfully start application', async () => {
            const app = (await new Application(serviceName).setConfig(configFactory))
                .setDeps(
                    (): ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>> => ({
                        logger: asValue(logger),
                        actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                        asyncLocalStorage: asValue(asyncLocalStorage),
                        envService: asClass(mockClass(EnvService)).singleton(),
                        moleculer: asClass(mockClass(MoleculerService)).singleton(),
                        validator: asClass(mockClass(AppValidator)).singleton(),
                        metrics: asClass(mockClass(MetricsService)).singleton(),
                        serviceName: asValue(serviceName),
                        config: asValue({}),
                        grpcClientFactory: asClass(mockClass(GrpcClientFactory)).singleton(),
                    }),
                )
                .initialize()

            await expect(app.start()).resolves.not.toThrow()
        })

        it('should successfully start application without store config', async () => {
            const cfg = async (envService: EnvService): Promise<BaseConfig> => {
                const { store, ...rest } = await configFactory(envService, serviceName)

                return rest
            }

            const app = (await new Application(serviceName).setConfig(cfg))
                .setDeps(
                    (): ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>> => ({
                        logger: asValue(logger),
                        actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                        asyncLocalStorage: asValue(asyncLocalStorage),
                        envService: asClass(mockClass(EnvService)).singleton(),
                        moleculer: asClass(mockClass(MoleculerService)).singleton(),
                        validator: asClass(mockClass(AppValidator)).singleton(),
                        metrics: asClass(mockClass(MetricsService)).singleton(),
                        serviceName: asValue(serviceName),
                        config: asValue({}),
                        grpcClientFactory: asClass(mockClass(GrpcClientFactory)).singleton(),
                    }),
                )
                .initialize()

            await expect(app.start()).resolves.not.toThrow()
        })

        it('should successfully start application without redis config', async () => {
            const cfg = async (envService: EnvService): Promise<BaseConfig> => {
                const { store, ...rest } = await configFactory(envService, serviceName)

                return rest
            }

            const app = (await new Application(serviceName).setConfig(cfg))
                .setDeps(
                    (): ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>> => ({
                        logger: asValue(logger),
                        actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                        asyncLocalStorage: asValue(asyncLocalStorage),
                        envService: asClass(mockClass(EnvService)).singleton(),
                        moleculer: asClass(mockClass(MoleculerService)).singleton(),
                        validator: asClass(mockClass(AppValidator)).singleton(),
                        metrics: asClass(mockClass(MetricsService)).singleton(),
                        serviceName: asValue(serviceName),
                        config: asValue({}),
                        grpcClientFactory: asClass(mockClass(GrpcClientFactory)).singleton(),
                    }),
                )
                .initialize()

            await expect(app.start()).resolves.not.toThrow()
        })

        it('should successfully stop application', async () => {
            const app = (await new Application(serviceName).setConfig(configFactory))
                .setDeps(
                    (): ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>> => ({
                        logger: asValue(logger),
                        actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                        asyncLocalStorage: asValue(asyncLocalStorage),
                        envService: asClass(mockClass(EnvService)).singleton(),
                        moleculer: asClass(mockClass(MoleculerService)).singleton(),
                        validator: asClass(mockClass(AppValidator)).singleton(),
                        metrics: asClass(mockClass(MetricsService)).singleton(),
                        serviceName: asValue(serviceName),
                        config: asValue({}),
                        grpcClientFactory: asClass(mockClass(GrpcClientFactory)).singleton(),
                    }),
                )
                .initialize()

            await app.stop()

            expect(logger.info).toHaveBeenCalledWith(`[onDestroy] Finished MoleculerService destruction`)
        })

        it('should log error and stop application on SIGINT', async () => {
            jest.spyOn(global, 'setImmediate').mockReturnThis()

            const app = (await new Application(serviceName).setConfig(configFactory))
                .setDeps(
                    (): ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>> => ({
                        logger: asValue(logger),
                        actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                        asyncLocalStorage: asValue(asyncLocalStorage),
                        envService: asClass(mockClass(EnvService)).singleton(),
                        moleculer: asClass(mockClass(MoleculerService)).singleton(),
                        validator: asClass(mockClass(AppValidator)).singleton(),
                        metrics: asClass(mockClass(MetricsService)).singleton(),
                        serviceName: asValue(serviceName),
                        config: asValue({}),
                        grpcClientFactory: asClass(mockClass(GrpcClientFactory)).singleton(),
                    }),
                )
                .initialize()

            await app.start()

            process.emit('SIGINT', 'SIGINT')

            expect(logger.error).toHaveBeenCalledWith('On SIGINT shutdown', { err: 'SIGINT' })
        })

        it('should shut down on uncaughtException', async () => {
            jest.spyOn(global, 'setImmediate').mockReturnThis()

            const app = (await new Application(serviceName).setConfig(configFactory))
                .setDeps(
                    (): ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>> => ({
                        logger: asValue(logger),
                        actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                        asyncLocalStorage: asValue(asyncLocalStorage),
                        envService: asClass(mockClass(EnvService)).singleton(),
                        moleculer: asClass(mockClass(MoleculerService)).singleton(),
                        validator: asClass(mockClass(AppValidator)).singleton(),
                        metrics: asClass(mockClass(MetricsService)).singleton(),
                        serviceName: asValue(serviceName),
                        config: asValue({}),
                        grpcClientFactory: asClass(mockClass(GrpcClientFactory)).singleton(),
                    }),
                )
                .initialize()

            await app.start()

            process.emit('uncaughtException', new AwilixError('Mocked error'))

            expect(logger.error).toHaveBeenCalledWith('On uncaughtException shutdown', { err: new AwilixError('Mocked error') })
        })

        it('should shut down on unhandledRejection', async () => {
            jest.spyOn(global, 'setImmediate').mockReturnThis()

            const app = (await new Application(serviceName).setConfig(configFactory))
                .setDeps(
                    (): ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>> => ({
                        logger: asValue(logger),
                        actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                        asyncLocalStorage: asValue(asyncLocalStorage),
                        envService: asClass(mockClass(EnvService)).singleton(),
                        moleculer: asClass(mockClass(MoleculerService)).singleton(),
                        validator: asClass(mockClass(AppValidator)).singleton(),
                        metrics: asClass(mockClass(MetricsService)).singleton(),
                        serviceName: asValue(serviceName),
                        config: asValue({}),
                        grpcClientFactory: asClass(mockClass(GrpcClientFactory)).singleton(),
                    }),
                )
                .initialize()

            process.emit('unhandledRejection', new AwilixError('Mocked error'), app.start())

            expect(logger.error).toHaveBeenCalledWith('On unhandledRejection shutdown', { err: new AwilixError('Mocked error') })
        })

        it('should throw error if config is not valid', async () => {
            const app = new Application(serviceName)

            await app.setConfig(async () => false)

            expect(() => {
                app.initialize()
            }).toThrow(new Error('Config should be set before using [getBaseDeps]'))
        })

        it('should throw error if has no config when do patch', () => {
            const app = new Application(serviceName)

            expect(() => {
                app.patchConfig({})
            }).toThrow(new Error('Config should be set before patch'))
        })

        it('should throw error when update existed config', async () => {
            const app = new Application(serviceName)

            await app.setConfig(configFactory)
            app.setDeps(
                (): ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>> => ({
                    logger: asValue(logger),
                    actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                    asyncLocalStorage: asValue(asyncLocalStorage),
                    envService: asClass(mockClass(EnvService)).singleton(),
                    moleculer: asClass(mockClass(MoleculerService)).singleton(),
                    validator: asClass(mockClass(AppValidator)).singleton(),
                    metrics: asClass(mockClass(MetricsService)).singleton(),
                    serviceName: asValue(serviceName),
                    config: asValue({}),
                    grpcClientFactory: asClass(mockClass(GrpcClientFactory)).singleton(),
                }),
            )

            expect(() => {
                app.patchConfig({})
            }).not.toThrow()
        })
    })

    describe(`method ${Application.prototype.setDeps.name}`, () => {
        it('should throw error if config was not set', () => {
            const app = new Application(serviceName)

            expect(() => {
                app.setDeps(
                    (): ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>> => ({
                        logger: asValue(logger),
                        actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                        asyncLocalStorage: asValue(asyncLocalStorage),
                        envService: asClass(mockClass(EnvService)).singleton(),
                        moleculer: asClass(mockClass(MoleculerService)).singleton(),
                        validator: asClass(mockClass(AppValidator)).singleton(),
                        metrics: asClass(mockClass(MetricsService)).singleton(),
                        serviceName: asValue(serviceName),
                        config: asValue({}),
                        grpcClientFactory: asClass(mockClass(GrpcClientFactory)).singleton(),
                    }),
                )
            }).toThrow(new Error('Config should be set before deps'))
        })

        it('should set deps', async () => {
            const app = (await new Application(serviceName).setConfig(configFactory))
                .setDeps(
                    (): ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>> => <ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>>>(<unknown>{
                            logger: asValue(logger),
                            actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                            asyncLocalStorage: asValue(asyncLocalStorage),
                            envService: asClass(mockClass(EnvService)).singleton(),
                            moleculer: asClass(mockClass(MoleculerService)).singleton(),
                            validator: asClass(mockClass(AppValidator)).singleton(),
                            metrics: asClass(mockClass(MetricsService)).singleton(),
                            serviceName: asValue(serviceName),
                            config: asFunction(configFactory),
                            healthCheck: asClass(mockClass(HealthCheck)).singleton(),
                        }),
                )
                .initialize()

            expect(app.deps.healthCheck).toBeTruthy()
        })
    })

    describe(`method ${Application.prototype.overrideDeps.name}`, () => {
        it('should successfully override deps', async () => {
            expect(() => {
                const app = new Application(serviceName)

                app.overrideDeps({
                    logger: asValue(logger),
                    actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                    asyncLocalStorage: asClass(mockClass(AsyncLocalStorage<AlsData>)).singleton(),
                    envService: asClass(mockClass(EnvService)).singleton(),
                    moleculer: asClass(mockClass(MoleculerService)).singleton(),
                    validator: asClass(mockClass(AppValidator)).singleton(),
                    serviceName: asValue(serviceName),
                    config: asFunction(configFactory),
                })
            }).not.toThrow(new Error('Config should be set before deps'))

            const app = (await new Application(serviceName).setConfig(configFactory))
                .setDeps(
                    (): ReturnType<DepsFactoryFn<BaseConfig, BaseDeps>> => ({
                        logger: asValue(logger),
                        actionFactory: asClass(mockClass(ActionFactory)).singleton(),
                        asyncLocalStorage: asValue(asyncLocalStorage),
                        envService: asClass(mockClass(EnvService)).singleton(),
                        moleculer: asClass(mockClass(MoleculerService)).singleton(),
                        validator: asClass(mockClass(AppValidator)).singleton(),
                        metrics: asClass(mockClass(MetricsService)).singleton(),
                        serviceName: asValue(serviceName),
                        config: asValue({}),
                        grpcClientFactory: asClass(mockClass(GrpcClientFactory)).singleton(),
                    }),
                )
                .overrideDeps({
                    healthCheck: asClass(mockClass(HealthCheck)).singleton(),
                })
                .initialize()

            expect(app.deps.healthCheck).toBeTruthy()
        })
    })
})
