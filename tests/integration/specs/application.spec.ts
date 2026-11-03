import { IdentifierService } from '@diia-inhouse/crypto'
import { HealthCheck } from '@diia-inhouse/healthcheck'

import { getApp } from '../getApp'

describe('Application', () => {
    it('should register the health check and, when configured, the identifier service', async () => {
        const app = await getApp()

        try {
            expect(app.container.resolve('healthCheck')).toBeInstanceOf(HealthCheck)
            expect(app.container.resolve('identifier')).toBeInstanceOf(IdentifierService)
        } finally {
            await app.stop()
        }
    })
})
