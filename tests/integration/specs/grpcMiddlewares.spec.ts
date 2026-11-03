import { DurationMs } from '@diia-inhouse/types'

import { clientCallOptions } from '../../../src'
import { GetTestRes } from '../generated/test-service'
import { getApp } from '../getApp'

describe('grpc-middlewares', () => {
    let app: Awaited<ReturnType<typeof getApp>>

    beforeAll(async () => {
        app = await getApp()
    })

    afterAll(async () => {
        await app.stop()
    })

    describe('deadline', () => {
        it('should end the call at the deadline the caller sets, before the default one', async () => {
            const startedAt = Date.now()

            await expect(
                app.container
                    .resolve('testServiceClient')
                    .getTest({ timeoutMs: DurationMs.Second * 20 }, clientCallOptions({ deadline: DurationMs.Second * 0.3 })),
            ).rejects.toThrow('/ua.gov.diia.test.Test/GetTest DEADLINE_EXCEEDED: Deadline exceeded')
            expect(Date.now() - startedAt).toBeLessThan(DurationMs.Second * 0.9)
        })
    })

    describe('default deadline', () => {
        it('should apply default deadline when none is provided', async () => {
            await expect(app.container.resolve('testServiceClient').getTest({ timeoutMs: DurationMs.Second * 20 })).rejects.toThrow(
                '/ua.gov.diia.test.Test/GetTest DEADLINE_EXCEEDED: Deadline exceeded',
            )
        })

        it('should allow explicit deadline to override default', async () => {
            const result = await app.container
                .resolve('testServiceClient')
                .getTest({ timeoutMs: DurationMs.Second }, clientCallOptions({ deadline: DurationMs.Second * 2 }))

            expect(result).toEqual<GetTestRes>({ status: 'ok' })
        })
    })
})
