import { AsyncLocalStorage } from 'node:async_hooks'

import { Service, ServiceEvents } from 'moleculer'
import ApiService from 'moleculer-web'
import { mock } from 'vitest-mock-extended'

import Logger from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { AlsData } from '@diia-inhouse/types'

import { ActionExecutor, BaseConfig, MoleculerService } from '../../../src'
import { appAction, appApiService } from '../../mocks'

describe(MoleculerService.name, () => {
    const logger = mock<Logger>()
    const config: BaseConfig = {
        transporter: { type: 'Redis', options: {} },
        metrics: { moleculer: { prometheus: { isEnabled: false, path: '/metrics' } } },
    }

    const createMoleculerService = (serviceConfig: BaseConfig, events: ServiceEvents = {}): MoleculerService =>
        new MoleculerService(
            'Auth',
            'auth-service',
            mock<ActionExecutor>(),
            [appAction],
            serviceConfig,
            mock<AsyncLocalStorage<AlsData>>(),
            logger,
            new EnvService(logger),
            mock<MetricsService>(),
            events,
            appApiService,
        )

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('should register an events-only service when actions are disabled but events exist', async () => {
        const moleculerEvents: ServiceEvents = { 'some.event': () => undefined }
        const moleculerService = createMoleculerService({ ...config, disableMoleculerActions: true }, moleculerEvents)
        const createService = vi.spyOn(moleculerService.serviceBroker, 'createService').mockReturnValue({} as Service)

        vi.spyOn(moleculerService.serviceBroker, 'start').mockResolvedValue()

        await moleculerService.onInit()

        expect(createService).toHaveBeenCalledWith(expect.objectContaining({ name: 'Auth', actions: {}, events: moleculerEvents }))
        expect(moleculerService.serviceBroker.start).toHaveBeenCalled()
    })

    it('should serve the HTTP API through moleculer-web with the configured CORS', async () => {
        const cors = {
            origins: ['https://a', 'https://b'],
            methods: [],
            allowedHeaders: [],
            exposedHeaders: [],
            credentials: false,
            maxAge: 1800,
        }
        const moleculerService = createMoleculerService({ ...config, cors })
        const createService = vi.spyOn(moleculerService.serviceBroker, 'createService').mockReturnValue({} as Service)

        vi.spyOn(moleculerService.serviceBroker, 'start').mockResolvedValue()

        await moleculerService.onInit()

        expect(createService).toHaveBeenCalledWith(
            expect.objectContaining({
                mixins: [ApiService],
                settings: expect.objectContaining({
                    port: appApiService.port,
                    ip: appApiService.ip,
                    cors: expect.objectContaining({ origin: 'https://a, https://b', maxAge: 1800 }),
                    qsOptions: { arrayLimit: 40 },
                }),
            }),
        )
    })

    it('should balance round-robin when no balancing strategy is configured', () => {
        const moleculerService = createMoleculerService(config)

        expect(moleculerService.serviceBroker.options.registry).toEqual({
            preferLocal: true,
            stopDelay: 100,
            strategy: 'RoundRobin',
            strategyOptions: {},
        })
    })

    it('should track contexts for graceful shutdown as the environment says', () => {
        vi.stubEnv('CONTEXT_TRACKING_ENABLED', 'false')
        vi.stubEnv('CONTEXT_TRACKING_TIMEOUT', '54321')

        const moleculerService = createMoleculerService(config)

        expect(moleculerService.serviceBroker.options.tracking).toEqual({
            enabled: false,
            shutdownTimeout: 54321,
        })
    })
})
