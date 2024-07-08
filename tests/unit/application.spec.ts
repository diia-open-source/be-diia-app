import { asClass, asValue } from 'awilix'

import { MetricsService } from '@diia-inhouse/diia-metrics'
import { mockClass } from '@diia-inhouse/test'

import { Application } from '../../src'

import { configFactory } from './config'

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

            return []
        },
    }
})

describe(`${Application.constructor.name}`, () => {
    const serviceName = 'Auth'
    const MockedMetricsService = mockClass(MetricsService)

    describe(`method ${Application.prototype.initialize.name}`, () => {
        it('should successfully start application', async () => {
            const app = new Application(serviceName)

            await app.setConfig(configFactory)
            await app.setDeps(async () => ({ metrics: asClass(MockedMetricsService).singleton() }))
            const appOperator = await app.initialize()

            await expect(appOperator.start()).resolves.not.toThrow()
        })

        it('should successfully stop application', async () => {
            const app = new Application(serviceName)

            await app.setConfig(configFactory)
            await app.setDeps(async () => ({ metrics: asClass(MockedMetricsService).singleton() }))
            const appOperator = await app.initialize()

            await expect(appOperator.stop()).resolves.not.toThrow()
        })

        it('should throw error if config is not set', async () => {
            const app = new Application(serviceName)

            await expect(app.initialize()).rejects.toThrow(new Error('Container and config should be initialized before creating context'))
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
            await app.setDeps(async () => ({ metrics: asClass(MockedMetricsService).singleton() }))

            expect(() => {
                app.patchConfig({})
            }).not.toThrow()
        })
    })

    describe(`method ${Application.prototype.setDeps.name}`, () => {
        it('should throw error if config was not set', async () => {
            const app = new Application(serviceName)

            await expect(app.setDeps(async () => ({ metrics: asClass(MockedMetricsService).singleton() }))).rejects.toThrow(
                new Error('Config should be set before deps'),
            )
        })

        it('should set deps', async () => {
            const app = new Application(serviceName)

            await app.setConfig(configFactory)
            await app.setDeps(async () => ({
                metrics: asClass(MockedMetricsService).singleton(),
                test: asValue('testValue'),
            }))
            const appOperator = await app.initialize()

            expect(appOperator.container.resolve('test')).toBe('testValue')
        })
    })
})
