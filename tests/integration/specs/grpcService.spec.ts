import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

import { ErrorType } from '@diia-inhouse/errors'
import { RedlockService } from '@diia-inhouse/redis'
import TestKit from '@diia-inhouse/test'
import { ActionVersion, ConnectionModes, HttpStatusCode, Logger, SessionType, grpcMetadataKeys } from '@diia-inhouse/types'

import { CallOptions, GrpcMetadata, clientCallOptions } from '../../../src'
import LockResourceAction from '../actions/v1/lockResource'
import { TestClient, TestPrivateClient } from '../generated'
import { EchoParamsReq } from '../generated/test-service'
import { getApp } from '../getApp'

describe('grpcService', () => {
    let app: Awaited<ReturnType<typeof getApp>>

    let testServiceClient: TestClient<CallOptions>
    let testPrivateServiceClient: TestPrivateClient<CallOptions>
    let redlock: RedlockService

    const testKit = new TestKit()

    const echoContext = async (options?: CallOptions): Promise<{ headers: Record<string, unknown>; session: unknown }> => {
        const { headersJson, sessionJson } = await testServiceClient.echoContext({}, options)

        return { headers: JSON.parse(headersJson), session: JSON.parse(sessionJson) }
    }

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

        it.each([
            { httpStatus: HttpStatusCode.BAD_REQUEST, status: 'INVALID_ARGUMENT', code: HttpStatusCode.BAD_REQUEST },
            { httpStatus: HttpStatusCode.UNAUTHORIZED, status: 'UNAUTHENTICATED', code: HttpStatusCode.UNAUTHORIZED },
            { httpStatus: HttpStatusCode.FORBIDDEN, status: 'PERMISSION_DENIED', code: HttpStatusCode.FORBIDDEN },
            { httpStatus: HttpStatusCode.TOO_MANY_REQUESTS, status: 'RESOURCE_EXHAUSTED', code: HttpStatusCode.TOO_MANY_REQUESTS },
            { httpStatus: HttpStatusCode.SERVICE_UNAVAILABLE, status: 'UNAVAILABLE', code: HttpStatusCode.SERVICE_UNAVAILABLE },
            { httpStatus: 418, status: 'UNKNOWN', code: HttpStatusCode.INTERNAL_SERVER_ERROR },
        ])('should answer an ApiError $httpStatus with $status', async ({ httpStatus, status, code }) => {
            await expect(testServiceClient.throwError({ httpStatus })).rejects.toMatchObject({
                message: `/ua.gov.diia.test.Test/ThrowError ${status}: error message`,
                code,
            })
        })
    })

    describe('action context', () => {
        it.each([
            { key: grpcMetadataKeys.TRACE_ID, header: 'traceId', value: 'trace-1' },
            { key: grpcMetadataKeys.ACCEPT_LANGUAGE, header: 'acceptLanguage', value: 'uk' },
            { key: grpcMetadataKeys.PLATFORM_TYPE, header: 'platformType', value: 'Android' },
            { key: grpcMetadataKeys.MOBILE_UID, header: 'mobileUid', value: 'mobile-1' },
            { key: grpcMetadataKeys.APP_VERSION, header: 'appVersion', value: '4.0.0' },
            { key: grpcMetadataKeys.PLATFORM_VERSION, header: 'platformVersion', value: '14' },
            {
                key: grpcMetadataKeys.TRACE_PARENT,
                header: 'traceparent',
                value: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
            },
            { key: grpcMetadataKeys.TRACE_STATE, header: 'tracestate', value: 'congo=t61rcWkgMzE' },
            { key: grpcMetadataKeys.CONTENT_TYPE, header: 'contentType', value: 'application/json' },
            { key: grpcMetadataKeys.TOKEN, header: 'token', value: 'token-1' },
            { key: grpcMetadataKeys.TICKET, header: 'ticket', value: 'ticket-1' },
            { key: grpcMetadataKeys.CHANNEL_UUID, header: 'channelUuid', value: 'channel-1' },
            { key: grpcMetadataKeys.CONNECTION_MODE, header: 'connectionMode', value: ConnectionModes.DirectToCell },
        ])('should pass $key metadata to the action as the $header header', async ({ key, header, value }) => {
            const metadata = new GrpcMetadata()

            metadata.set(key, value)

            const { headers } = await echoContext({ metadata })

            expect(headers[header]).toBe(value)
        })

        it('should mark the action headers with the calling service', async () => {
            const { headers } = await echoContext()

            expect(headers).toMatchObject({ sentFrom: 'Auth', tracing: '{}', actionVersion: ActionVersion.V1 })
        })

        it.each(Object.values(SessionType).filter((type) => type !== SessionType.None))(
            'should pass a %s session to the action',
            async (sessionType) => {
                const session = testKit.session.getSessionBySessionType(sessionType)

                const result = await echoContext(clientCallOptions({ session }))

                expect(result.session).toEqual(JSON.parse(JSON.stringify(session)))
            },
        )

        it('should give the action a None session when the caller sends none', async () => {
            const { session } = await echoContext()

            expect(session).toEqual({ sessionType: SessionType.None })
        })
    })

    describe('action versions', () => {
        it.each([
            { description: 'the newest version when the caller sends none', version: undefined, expected: ActionVersion.V2 },
            { description: 'the version the caller asks for', version: ActionVersion.V1, expected: ActionVersion.V1 },
        ])('should answer with $description', async ({ version, expected }) => {
            await expect(testServiceClient.getVersioned({ timeoutMs: 1 }, clientCallOptions({ version }))).resolves.toEqual({
                version: expected,
            })
        })

        it('should reject a version no action declares', async () => {
            await expect(
                testServiceClient.getVersioned({ timeoutMs: 1 }, clientCallOptions({ version: ActionVersion.V3 })),
            ).rejects.toMatchObject({
                code: HttpStatusCode.NOT_IMPLEMENTED,
                message: '/ua.gov.diia.test.Test/GetVersioned UNIMPLEMENTED: Configuration error: action not found for version v3',
            })
        })

        it('should serve an unversioned action whatever version the caller asks for', async () => {
            await expect(testServiceClient.getTest({ timeoutMs: 1 }, clientCallOptions({ version: ActionVersion.V3 }))).resolves.toEqual({
                status: 'ok',
            })
        })
    })

    describe('params', () => {
        it.each<{ description: string; request: EchoParamsReq; expected: object }>([
            {
                description: 'flat optional fields',
                request: { name: 'John', nickname: 'johnny', items: [], plain: undefined },
                expected: { name: 'John', nickname: 'johnny', items: [] },
            },
            {
                description: 'nested optional fields',
                request: { name: 'John', nested: { value: 'test', extra: 'data' }, items: [], plain: undefined },
                expected: { name: 'John', nested: { value: 'test', extra: 'data' }, items: [] },
            },
            {
                description: 'deeply nested optional fields',
                request: {
                    name: 'John',
                    nested: { value: 'level1', deep: { id: 'deep-1', label: 'deep-label' } },
                    items: [],
                    plain: undefined,
                },
                expected: { name: 'John', nested: { value: 'level1', deep: { id: 'deep-1', label: 'deep-label' } }, items: [] },
            },
            {
                description: 'repeated nested messages',
                request: {
                    name: 'John',
                    items: [{ value: 'a', extra: 'x1' }, { value: 'b', deep: { id: 'd1', label: 'l1' } }, { value: 'c' }],
                    plain: undefined,
                },
                expected: {
                    name: 'John',
                    items: [{ value: 'a', extra: 'x1' }, { value: 'b', deep: { id: 'd1', label: 'l1' } }, { value: 'c' }],
                },
            },
            {
                description: 'an omitted message field',
                request: { name: 'John', items: [], plain: undefined },
                expected: { name: 'John', items: [] },
            },
            {
                description: 'a present message field',
                request: { name: 'John', plain: { value: 'v' }, items: [] },
                expected: { name: 'John', plain: { value: 'v' }, items: [] },
            },
        ])('should pass $description to the action exactly as sent', async ({ request, expected }) => {
            const { paramsJson } = await testServiceClient.echoParams(request)

            expect(JSON.parse(paramsJson)).toEqual(expected)
        })

        it.each(['date', 'seconds'])('should return a Timestamp the action gives as %s as the same instant', async (shape) => {
            const at = new Date('2026-11-02T10:20:30.456Z')

            await expect(testServiceClient.echoTimestamp({ at, shape })).resolves.toEqual({ at, receivedAs: 'Date' })
        })
    })

    it('should lock the resource while the action runs and release it after', async () => {
        const resource = `lockResource.${randomUUID()}`
        const action = app.container.resolve<LockResourceAction>('v1LockResourceAction')
        let isLockedWhileRunning: boolean | undefined

        vi.spyOn(action, 'handler').mockImplementationOnce(async () => {
            isLockedWhileRunning = await redlock.lock(resource, 1000, { acquireTimeout: 100 }).then(
                async (lock) => {
                    await lock.release()

                    return false
                },
                () => true,
            )

            return { status: 'ok' }
        })

        await expect(testServiceClient.lockResource({ id: resource.split('.')[1] })).resolves.toEqual({ status: 'ok' })
        const lock = await redlock.lock(resource, 1000, { acquireTimeout: 100 })

        expect(isLockedWhileRunning).toBe(true)
        await lock.release()
    })

    describe('action with tryLockTimeout', () => {
        it('should warn and run the handler without the lock when the resource stays busy', async () => {
            const logger = app.container.resolve<Logger>('logger')
            const warnSpy = vi.spyOn(logger, 'warn')
            const errorSpy = vi.spyOn(logger, 'error')
            const id = randomUUID()
            const holder = await redlock.lock(`tryLockResource.${id}`, 30000)

            try {
                const { status } = await testServiceClient.tryLockResource({ id })

                expect(status).toBe('ok')
                expect(warnSpy).toHaveBeenCalledWith(
                    'Lock resource is busy, executing action without lock: /ua.gov.diia.test.Test/TryLockResource',
                )
                expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('acquiring lock'), expect.anything())
            } finally {
                await holder.release()
            }
        })

        it('should not leave the lock orphaned after giving up on a locked resource', async () => {
            const id = randomUUID()
            const resource = `tryLockResource.${id}`
            const holder = await redlock.lock(resource, 30000)

            const { status } = await testServiceClient.tryLockResource({ id })

            expect(status).toBe('ok')

            await holder.release()
            // an abandoned acquire keeps retrying every 500ms and would grab the freed lock
            await sleep(1000)

            const lock = await redlock.lock(resource, 1000, { acquireTimeout: 100 })

            await lock.release()
        })
    })
})
