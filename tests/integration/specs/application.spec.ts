import { getApp } from '../getApp'

describe('Application', () => {
    it('should start', async () => {
        const app = await getApp()

        const services = ['healthCheck', 'identifier']

        for (const service of services) {
            expect(app.container.resolve(service)).toBeDefined()
        }

        await app.stop()
    })
})
