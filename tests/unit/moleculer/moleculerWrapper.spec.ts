import { AsyncLocalStorage } from 'node:async_hooks'

import { Service } from 'moleculer'
import { mock } from 'vitest-mock-extended'

import Logger from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { ApiError, ErrorType, NotFoundError } from '@diia-inhouse/errors'
import { ActionVersion, AlsData, HttpStatusCode } from '@diia-inhouse/types'

import { ActionExecutor, AppApiService, ConfigFactoryFn, MoleculerService } from '../../../src'
import { appAction, appApiService } from '../../mocks'
import { configFactory } from '../config'

describe(`${MoleculerService.name}`, () => {
    const serviceName = 'Auth'
    const systemServiceName = 'auth-service'
    const logger = mock<Logger>()
    const envService = new EnvService(logger)
    const actionExecutor = mock<ActionExecutor>()
    const asyncLocalStorage = mock<AsyncLocalStorage<AlsData>>()
    const metrics = mock<MetricsService>({
        totalRequestMetric: {
            increment: vi.fn(),
        },
        totalTimerMetric: {
            observeSeconds: vi.fn(),
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
                systemServiceName,
                actionExecutor,
                [appAction],
                cfg,
                asyncLocalStorage,
                logger,
                envService,
                metrics,
                {},
                appApiService,
            )

            vi.spyOn(moleculerService.serviceBroker, 'createService').mockReturnValue({} as Service)
            vi.spyOn(moleculerService.serviceBroker, 'start').mockResolvedValue()

            await moleculerService.onInit()

            expect(moleculerService.serviceBroker.createService).toHaveBeenCalled()
            expect(moleculerService.serviceBroker.start).toHaveBeenCalled()
        })

        it('should create service broker with default registry options', async () => {
            const { balancing, ...configWithoutBalancing } = await configFactory(envService, serviceName)
            const moleculerService = new MoleculerService(
                serviceName,
                systemServiceName,
                actionExecutor,
                [appAction],
                configWithoutBalancing,
                asyncLocalStorage,
                logger,
                envService,
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
                systemServiceName,
                actionExecutor,
                [appAction],
                cfg,
                asyncLocalStorage,
                logger,
                envService,
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
                systemServiceName,
                actionExecutor,
                [appAction],
                { ...cfg, cors: undefined },
                asyncLocalStorage,
                logger,
                envService,
                metrics,
                {},
                {} as AppApiService,
            )

            vi.spyOn(moleculerService.serviceBroker, 'createService').mockReturnValue({} as Service)
            vi.spyOn(moleculerService.serviceBroker, 'start').mockResolvedValue()
            vi.spyOn(moleculerService.serviceBroker, 'stop').mockResolvedValue()

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
                systemServiceName,
                actionExecutor,
                [appAction],
                cfg,
                asyncLocalStorage,
                logger,
                envService,
                metrics,
                {},
                {} as AppApiService,
            )

            vi.spyOn(moleculerService.serviceBroker, 'call').mockResolvedValue(expectedResult)

            expect(await moleculerService.act(serviceName, { name: 'auth', actionVersion: ActionVersion.V1 })).toEqual(expectedResult)
            expect(logger.info).toHaveBeenCalled()
        })

        it('should fail to call broker action with opOriginalError', async () => {
            const error = new NotFoundError('Unable to execute action')
            const data = {
                opOriginalError: {
                    type: ErrorType.Unoperated,
                },
            }

            const expectedError = new ApiError('Unable to execute action', HttpStatusCode.NOT_FOUND, data)

            const moleculerService = new MoleculerService(
                serviceName,
                systemServiceName,
                actionExecutor,
                [appAction],
                cfg,
                asyncLocalStorage,
                logger,
                envService,
                metrics,
            )

            vi.spyOn(moleculerService.serviceBroker, 'call').mockRejectedValueOnce(error)

            await expect(moleculerService.act(serviceName, { name: 'auth', actionVersion: ActionVersion.V1 })).rejects.toMatchObject(
                expectedError,
            )
        })

        it('should fail to call broker action without opOriginalError', async () => {
            const error = new NotFoundError('Unable to execute action')
            const data = {
                opOriginalError: {
                    type: ErrorType.Unoperated,
                },
            }
            const expectedError = new ApiError('Unable to execute action', HttpStatusCode.NOT_FOUND, data)

            const moleculerService = new MoleculerService(
                serviceName,
                systemServiceName,
                actionExecutor,
                [appAction],
                cfg,
                asyncLocalStorage,
                logger,
                envService,
                metrics,
            )

            vi.spyOn(moleculerService.serviceBroker, 'call').mockRejectedValueOnce(error)

            await expect(moleculerService.act(serviceName, { name: 'auth', actionVersion: ActionVersion.V1 })).rejects.toEqual(
                expectedError,
            )
        })
    })

    describe(`method ${MoleculerService.prototype.tryToAct.name}`, () => {
        it('should successfully call broker action', async () => {
            const expectedResult: string[] = []
            const moleculerService = new MoleculerService(
                serviceName,
                systemServiceName,
                actionExecutor,
                [appAction],
                cfg,
                asyncLocalStorage,
                logger,
                envService,
                metrics,
                {},
                {} as AppApiService,
            )

            vi.spyOn(moleculerService.serviceBroker, 'call').mockResolvedValue(expectedResult)

            expect(await moleculerService.tryToAct(serviceName, { name: 'auth', actionVersion: ActionVersion.V1 })).toEqual(expectedResult)
            expect(logger.info).toHaveBeenCalled()
        })

        it('should not fail to call broker action', async () => {
            const expectedError = new Error('Unable to execute action')
            const moleculerService = new MoleculerService(
                serviceName,
                systemServiceName,
                actionExecutor,
                [appAction],
                cfg,
                asyncLocalStorage,
                logger,
                envService,
                metrics,
            )

            vi.spyOn(moleculerService.serviceBroker, 'call').mockRejectedValue(expectedError)

            expect(await moleculerService.tryToAct(serviceName, { name: 'auth', actionVersion: ActionVersion.V1 })).toBeUndefined()
        })
    })
})
