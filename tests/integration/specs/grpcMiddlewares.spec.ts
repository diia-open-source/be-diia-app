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
        it('should return response', async () => {
            const result = await app.container
                .resolve('testServiceClient')
                .getTest({ timeoutMs: DurationMs.Second * 0.1 }, clientCallOptions({ deadline: DurationMs.Second * 10 }))

            expect(result).toEqual<GetTestRes>({ status: 'ok' })
        })

        it('should return deadline error via clientCallOptions', async () => {
            await expect(
                app.container
                    .resolve('testServiceClient')
                    .getTest({ timeoutMs: DurationMs.Second * 20 }, clientCallOptions({ deadline: DurationMs.Second * 0.5 })),
            ).rejects.toThrow('/ua.gov.diia.test.Test/GetTest DEADLINE_EXCEEDED: Deadline exceeded')
        })

        it('should return deadline error via direct options', async () => {
            await expect(
                app.container
                    .resolve('testServiceClient')
                    .getTest({ timeoutMs: DurationMs.Second * 20 }, { deadline: DurationMs.Second * 0.5 }),
            ).rejects.toThrow('/ua.gov.diia.test.Test/GetTest DEADLINE_EXCEEDED: Deadline exceeded')
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
