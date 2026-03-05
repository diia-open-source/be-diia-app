import { ErrorType } from '@diia-inhouse/errors'
import { RedlockService } from '@diia-inhouse/redis'
import TestKit from '@diia-inhouse/test'
import { HttpStatusCode, SessionType } from '@diia-inhouse/types'

import { clientCallOptions } from '../../../src'
import { TestClient, TestPrivateClient } from '../generated'
import { getApp } from '../getApp'

describe('grpcService', () => {
    let app: Awaited<ReturnType<typeof getApp>>

    let testServiceClient: TestClient
    let testPrivateServiceClient: TestPrivateClient
    let redlock: RedlockService

    const testKit = new TestKit()

    beforeAll(async () => {
        app = await getApp()
        testServiceClient = app.container.resolve('testServiceClient')
        testPrivateServiceClient = app.container.resolve('testPrivateServiceClient')
        redlock = app.container.resolve<RedlockService>('redlock')
    })

    afterAll(async () => {
        await app.stop()
    })

    it('should start gRPC server with declared services', async () => {
        const result = await Promise.all([
            testServiceClient.getTest({ timeoutMs: 1 }),
            testPrivateServiceClient.getTestPrivate({ timeoutMs: 1 }),
        ])

        expect(result).toEqual([{ status: 'ok' }, { status: 'ok' }])
    })

    describe('errors', () => {
        it('should throw an grpc error when action throws an ApiError', async () => {
            const code = HttpStatusCode.NOT_FOUND

            await expect(
                testServiceClient.throwError({
                    httpStatus: code,
                    data: {
                        description: 'error description',
                    },
                    type: ErrorType.Operated,
                }),
            ).rejects.toMatchObject({
                message: '/ua.gov.diia.test.Test/ThrowError NOT_FOUND: error message',
                code,
                data: {
                    description: 'error description',
                    opOriginalError: {
                        type: ErrorType.Operated,
                    },
                },
                type: ErrorType.Unoperated,
            })
        })

        it('should throw an grpc error when action throws an ApiError with processCode', async () => {
            const processCode = 11111
            const httpStatus = HttpStatusCode.NOT_FOUND

            await expect(
                testServiceClient.throwError({
                    httpStatus,
                    processCode,
                    data: {
                        description: 'error description',
                    },
                }),
            ).rejects.toMatchObject({
                message: '/ua.gov.diia.test.Test/ThrowError NOT_FOUND: error message',
                code: httpStatus,
                data: {
                    description: 'error description',
                    processCode,
                    opOriginalError: {
                        type: ErrorType.Unoperated,
                    },
                },
            })
        })
    })

    it.each(Object.values(SessionType))('should handle %s session', async (sessionType: SessionType) => {
        const session = testKit.session.getSessionBySessionType(sessionType)

        const { status } = await testServiceClient.getTest({ timeoutMs: 1 }, clientCallOptions({ session }))

        expect(status).toBe('ok')
    })

    it('should lock resource', async () => {
        const redlockSpy = vi.spyOn(redlock, 'lock')

        const { status } = await testServiceClient.lockResource({ id: '123' })

        expect(status).toBe('ok')
        expect(redlockSpy).toHaveBeenCalledWith('lockResource.123', 30000)
    })
})
