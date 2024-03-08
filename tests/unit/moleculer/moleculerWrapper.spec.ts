const actionTypesJsonParse = jest.fn()

jest.mock('../../../src/actionJsonConvertor', () => ({ actionTypesJsonParse }))

import { AsyncLocalStorage } from 'async_hooks'

import { Service } from 'moleculer'

import Logger from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { mockInstance } from '@diia-inhouse/test'
import { ActionVersion, AlsData } from '@diia-inhouse/types'
import { AppValidator } from '@diia-inhouse/validators'

import { ActionFactory, AppApiService, ConfigFactoryFn, MoleculerService } from '../../../src'
import { appAction, appApiService, configFactory } from '../../mocks'

describe(`${MoleculerService.name}`, () => {
    const serviceName = 'Auth'
    const logger = mockInstance(Logger)
    const envService = new EnvService(logger)
    const asyncLocalStorage = mockInstance(AsyncLocalStorage<AlsData>)
    const actionFactory = mockInstance(ActionFactory)
    const validator = mockInstance(AppValidator)
    const metrics = mockInstance(MetricsService, {
        totalRequestMetric: {
            increment: jest.fn(),
        },
        totalTimerMetric: {
            observeSeconds: jest.fn(),
        },
    })
    let cfg: Awaited<ReturnType<ConfigFactoryFn>>

    beforeAll(async () => {
        cfg = await configFactory(envService, serviceName)
    })

    describe(`method ${MoleculerService.prototype.onInit.name}`, () => {
        it('should successfully init moleculer and start service', async () => {
            const moleculerService = new MoleculerService(
                serviceName,
                actionFactory,
                [appAction],
                cfg,
                asyncLocalStorage,
                validator,
                logger,
                metrics,
                {},
                appApiService,
            )

            jest.spyOn(actionFactory, 'createActions').mockReturnValue({})
            jest.spyOn(moleculerService.serviceBroker, 'createService').mockReturnValue(<Service>{})
            jest.spyOn(moleculerService.serviceBroker, 'start').mockResolvedValue()

            await moleculerService.onInit()

            expect(actionFactory.createActions).toHaveBeenCalledWith([appAction])
            expect(moleculerService.serviceBroker.createService).toHaveBeenCalled()
            expect(moleculerService.serviceBroker.start).toHaveBeenCalled()
        })

        it('should create service broker with default registry options', async () => {
            const { balancing, ...configWithoutBalancing } = await configFactory(envService, serviceName)
            const moleculerService = new MoleculerService(
                serviceName,
                actionFactory,
                [appAction],
                configWithoutBalancing,
                asyncLocalStorage,
                validator,
                logger,
                metrics,
                {},
                appApiService,
            )

            expect(moleculerService.serviceBroker.options.registry).toEqual({
                preferLocal: true,
                stopDelay: 100,
                strategy: 'RoundRobin',
                strategyOptions: {},
            })
        })

        it('should create service broker with specified in env tracking options', () => {
            process.env.CONTEXT_TRACKING_ENABLED = 'false'
            process.env.CONTEXT_TRACKING_TIMEOUT = '54321'

            const moleculerService = new MoleculerService(
                serviceName,
                actionFactory,
                [appAction],
                cfg,
                asyncLocalStorage,
                validator,
                logger,
                metrics,
                {},
                appApiService,
            )

            expect(moleculerService.serviceBroker.options.tracking).toEqual({
                enabled: false,
                shutdownTimeout: 54321,
            })
        })
    })

    describe(`method ${MoleculerService.prototype.onDestroy.name}`, () => {
        it('should successfully destroy moleculer and stop service', async () => {
            const moleculerService = new MoleculerService(
                serviceName,
                actionFactory,
                [appAction],
                { ...cfg, ...{ cors: undefined } },
                asyncLocalStorage,
                validator,
                logger,
                metrics,
                {},
                <AppApiService>{},
            )

            jest.spyOn(actionFactory, 'createActions').mockReturnValue({})
            jest.spyOn(moleculerService.serviceBroker, 'createService').mockReturnValue(<Service>{})
            jest.spyOn(moleculerService.serviceBroker, 'start').mockResolvedValue()
            jest.spyOn(moleculerService.serviceBroker, 'stop').mockResolvedValue()

            await moleculerService.onInit()
            await moleculerService.onDestroy()

            expect(moleculerService.serviceBroker.stop).toHaveBeenCalled()
        })
    })

    describe(`method ${MoleculerService.prototype.act.name}`, () => {
        it('should successfully call broker action', async () => {
            const expectedResult: string[] = []
            const moleculerService = new MoleculerService(
                serviceName,
                actionFactory,
                [appAction],
                cfg,
                asyncLocalStorage,
                validator,
                logger,
                metrics,
                {},
                <AppApiService>{},
            )

            jest.spyOn(moleculerService.serviceBroker, 'call').mockResolvedValue(expectedResult)
            actionTypesJsonParse.mockReturnValue(expectedResult)

            expect(await moleculerService.act(serviceName, { name: 'auth', actionVersion: ActionVersion.V1 })).toEqual(expectedResult)
            expect(logger.info).toHaveBeenCalled()
        })

        it('should fail to call broker action', async () => {
            const expectedError = new Error('Unable to execute action')
            const moleculerService = new MoleculerService(
                serviceName,
                actionFactory,
                [appAction],
                cfg,
                asyncLocalStorage,
                validator,
                logger,
                metrics,
            )

            jest.spyOn(moleculerService.serviceBroker, 'call').mockRejectedValue(expectedError)

            await expect(async () => {
                await moleculerService.act(serviceName, { name: 'auth', actionVersion: ActionVersion.V1 })
            }).rejects.toEqual(expectedError)
        })
    })

    describe(`method ${MoleculerService.prototype.tryToAct.name}`, () => {
        it('should successfully call broker action', async () => {
            const expectedResult: string[] = []
            const moleculerService = new MoleculerService(
                serviceName,
                actionFactory,
                [appAction],
                cfg,
                asyncLocalStorage,
                validator,
                logger,
                metrics,
                {},
                <AppApiService>{},
            )

            jest.spyOn(moleculerService.serviceBroker, 'call').mockResolvedValue(expectedResult)
            actionTypesJsonParse.mockReturnValue(expectedResult)

            expect(await moleculerService.tryToAct(serviceName, { name: 'auth', actionVersion: ActionVersion.V1 })).toEqual(expectedResult)
            expect(logger.info).toHaveBeenCalled()
        })

        it('should not fail to call broker action', async () => {
            const expectedError = new Error('Unable to execute action')
            const moleculerService = new MoleculerService(
                serviceName,
                actionFactory,
                [appAction],
                cfg,
                asyncLocalStorage,
                validator,
                logger,
                metrics,
            )

            jest.spyOn(moleculerService.serviceBroker, 'call').mockRejectedValue(expectedError)

            expect(await moleculerService.tryToAct(serviceName, { name: 'auth', actionVersion: ActionVersion.V1 })).toBeUndefined()
        })
    })
})
