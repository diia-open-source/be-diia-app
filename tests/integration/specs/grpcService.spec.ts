import { ErrorType } from '@diia-inhouse/errors'
import { RedlockService } from '@diia-inhouse/redis'
import TestKit from '@diia-inhouse/test'
import { HttpStatusCode, SessionType } from '@diia-inhouse/types'
import { GenericObject } from '@diia-inhouse/types/dist/types/common'

import { GrpcService, clientCallOptions } from '../../../src'
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

    describe('synthetic oneof fields', () => {
        it('should receive params with underscore fields from grpc deserialization before stripping', async () => {
            const grpcService = app.container.resolve<GrpcService>('grpcService')
            const originalExecuteAction = grpcService['executeAction'].bind(grpcService)
            let capturedRawParams: GenericObject | undefined

            grpcService['executeAction'] = async (action, metadata, headers, params): Promise<unknown> => {
                capturedRawParams = structuredClone(params)

                return await originalExecuteAction(action, metadata, headers, params)
            }

            expect.assertions(6)
            try {
                await testServiceClient.echoParams({
                    name: 'John',
                    nickname: 'johnny',
                    nested: { value: 'test', extra: 'data', deep: { id: 'd1', label: 'lbl' } },
                    items: [{ value: 'item1', extra: 'x' }],
                })

                expect(capturedRawParams).toHaveProperty('_nickname', 'nickname')
                expect(capturedRawParams).toHaveProperty('_nested', 'nested')
                expect(capturedRawParams!.nested).toHaveProperty('_extra', 'extra')
                expect(capturedRawParams!.nested).toHaveProperty('_deep', 'deep')
                expect(capturedRawParams!.nested.deep).toHaveProperty('_label', 'label')
                expect(capturedRawParams!.items[0]).toHaveProperty('_extra', 'extra')
            } finally {
                grpcService['executeAction'] = originalExecuteAction
            }
        })

        it('should strip synthetic oneof fields from flat optional params', async () => {
            const { paramsJson } = await testServiceClient.echoParams({
                name: 'John',
                nickname: 'johnny',
            })
            const params = JSON.parse(paramsJson)

            expect(params).toHaveProperty('name', 'John')
            expect(params).toHaveProperty('nickname', 'johnny')
            expect(params).not.toHaveProperty('_nickname')
            expect(params).not.toHaveProperty('_nested')
        })

        it('should strip synthetic oneof fields from nested optional params', async () => {
            const { paramsJson } = await testServiceClient.echoParams({
                name: 'John',
                nickname: 'johnny',
                nested: { value: 'test', extra: 'data' },
            })
            const params = JSON.parse(paramsJson)

            expect(params).not.toHaveProperty('_nickname')
            expect(params).not.toHaveProperty('_nested')
            expect(params.nested).toHaveProperty('value', 'test')
            expect(params.nested).toHaveProperty('extra', 'data')
            expect(params.nested).not.toHaveProperty('_extra')
            expect(params.nested).not.toHaveProperty('_deep')
        })

        it('should strip synthetic oneof fields from deeply nested optional params', async () => {
            const { paramsJson } = await testServiceClient.echoParams({
                name: 'John',
                nested: {
                    value: 'level1',
                    extra: 'e1',
                    deep: { id: 'deep-1', label: 'deep-label' },
                },
            })
            const params = JSON.parse(paramsJson)

            expect(params).not.toHaveProperty('_nickname')
            expect(params).not.toHaveProperty('_nested')
            expect(params.nested).not.toHaveProperty('_extra')
            expect(params.nested).not.toHaveProperty('_deep')
            expect(params.nested.deep).toEqual({ id: 'deep-1', label: 'deep-label' })
            expect(params.nested.deep).not.toHaveProperty('_label')
        })

        it('should strip synthetic oneof fields from repeated nested messages', async () => {
            const { paramsJson } = await testServiceClient.echoParams({
                name: 'John',
                items: [{ value: 'a', extra: 'x1' }, { value: 'b', extra: 'x2', deep: { id: 'd1', label: 'l1' } }, { value: 'c' }],
            })
            const params = JSON.parse(paramsJson)

            expect(params).not.toHaveProperty('_nickname')
            expect(params).not.toHaveProperty('_nested')

            for (const item of params.items) {
                expect(item).not.toHaveProperty('_extra')
                expect(item).not.toHaveProperty('_deep')
            }

            expect(params.items[0]).toEqual({ value: 'a', extra: 'x1' })
            expect(params.items[1].deep).toEqual({ id: 'd1', label: 'l1' })
            expect(params.items[1].deep).not.toHaveProperty('_label')
        })

        it('should strip synthetic oneof fields when optional fields are not set', async () => {
            const { paramsJson } = await testServiceClient.echoParams({ name: 'John' })
            const params = JSON.parse(paramsJson)

            expect(params).toEqual({ name: 'John', items: [] })
            expect(params).not.toHaveProperty('_nickname')
            expect(params).not.toHaveProperty('_nested')
        })
    })

    it('should lock resource', async () => {
        const redlockSpy = vi.spyOn(redlock, 'lock')

        const { status } = await testServiceClient.lockResource({ id: '123' })

        expect(status).toBe('ok')
        expect(redlockSpy).toHaveBeenCalledWith('lockResource.123', 30000)
    })
})
