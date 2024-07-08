import TestKit from '@diia-inhouse/test'
import { GrpcStatusCode, HttpStatusCode, SessionType } from '@diia-inhouse/types'

import { clientCallOptions } from '../../../src'
import { getApp } from '../getApp'

describe('grpcService', () => {
    let app: Awaited<ReturnType<typeof getApp>>
    const testKit = new TestKit()

    beforeAll(async () => {
        app = await getApp()
    })

    afterAll(async () => {
        await app.stop()
    })

    it('should start gRPC server with declared services', async () => {
        const result = await Promise.all([
            app.container.resolve('testServiceClient').getTest({ timeoutMs: 1 }),
            app.container.resolve('testPrivateServiceClient').getTestPrivate({ timeoutMs: 1 }),
        ])

        expect(result).toEqual([{ status: 'ok' }, { status: 'ok' }])
    })

    describe('errors', () => {
        it('should throw an grpc error when action throws an ApiError', async () => {
            await expect(app.container.resolve('testServiceClient').throwError({ httpStatus: HttpStatusCode.NOT_FOUND })).rejects.toThrow(
                expect.objectContaining({
                    message: '/ua.gov.diia.test.Test/ThrowError NOT_FOUND: error message',
                    code: GrpcStatusCode.NOT_FOUND,
                }),
            )
        })

        it('should throw an grpc error when action throws an ApiError with processCode', async () => {
            const processCode = 11111

            await expect(
                app.container.resolve('testServiceClient').throwError({ httpStatus: HttpStatusCode.NOT_FOUND, processCode }),
            ).rejects.toThrow(
                expect.objectContaining({
                    message: '/ua.gov.diia.test.Test/ThrowError NOT_FOUND: error message',
                    code: processCode,
                    data: { processCode },
                }),
            )
        })
    })

    it.each(Object.values(SessionType))('should handle %s session', async (sessionType: SessionType) => {
        const session = testKit.session.getSessionBySessionType(sessionType)

        const { status } = await app.container.resolve('testServiceClient').getTest({ timeoutMs: 1 }, clientCallOptions({ session }))

        expect(status).toBe('ok')
    })

    it('should lock resource', async () => {
        const redlockSpy = jest.spyOn(app.container.resolve('redlock')!, 'lock')
        const { status } = await app.container.resolve('testServiceClient').lockResource({ id: '123' })

        expect(status).toBe('ok')
        expect(redlockSpy).toHaveBeenCalledWith('lockResource.123', 30000)
    })
})
