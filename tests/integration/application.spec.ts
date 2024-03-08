import { Application, ServiceContext } from '../../src'
import { configFactory } from '../mocks'

import deps from './deps'
import { AppConfig } from './interfaces/config'
import { AppDeps } from './interfaces/deps'

describe('Application', () => {
    it('should start', async () => {
        const app = (await new Application<ServiceContext<AppConfig, AppDeps>>('Auth').setConfig(configFactory)).setDeps(deps).initialize()

        await app.start()

        const services = ['eventBus', 'externalEventBus']

        services.forEach((service) => expect(app.container.resolve(service)).toBeDefined())
    })
})
