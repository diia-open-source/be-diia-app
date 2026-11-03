import { randomUUID } from 'node:crypto'

import { register } from 'prom-client'

import { FeatureService } from '@diia-inhouse/features'
import { grpcMetadataKeys } from '@diia-inhouse/types'

import { CallOptions, GrpcMetadata } from '../../../src'
import { MetricNames } from '../../../src/interfaces/metrics'
import SubscribeTestAction, { subscribeTestProcessCode } from '../actions/v1/subscribeTest'
import { TestClient } from '../generated'
import { SubscribeTestReq, TestEvent } from '../generated/test-service'
import { getApp } from '../getApp'

interface OpenStream {
    events: AsyncIterator<TestEvent>
    cancel: () => void
}

const openStreamCount = async (): Promise<number | undefined> => {
    const metric = await register.getSingleMetric(MetricNames.GrpcStreamConnections)?.get()

    return metric?.values[0]?.value
}

describe('gRPC streams', () => {
    let app: Awaited<ReturnType<typeof getApp>>
    let client: TestClient<CallOptions>
    let subscribeAction: SubscribeTestAction
    let featureFlag: FeatureService

    const open = (request: SubscribeTestReq, mobileUid: string): OpenStream => {
        const controller = new AbortController()
        const metadata = new GrpcMetadata()

        metadata.set(grpcMetadataKeys.MOBILE_UID, mobileUid)
        const events = client.subscribeTest(request, { metadata, deadline: 10_000, signal: controller.signal })[Symbol.asyncIterator]()

        return { events, cancel: () => controller.abort() }
    }

    const closedConnectionsOf = (mobileUid: string): SubscribeTestAction['closedConnections'] =>
        subscribeAction.closedConnections.filter(({ headers }) => headers.mobileUid === mobileUid)

    beforeAll(async () => {
        app = await getApp()
        client = app.container.resolve('testServiceClient')
        subscribeAction = app.container.resolve('v1SubscribeTestAction')
        featureFlag = app.container.resolve<FeatureService>('featureFlag')
    })

    afterAll(async () => {
        await app.stop()
    })

    it("should send the handler's response, then published events, and report the caller's cancel to the action", async () => {
        const mobileUid = randomUUID()
        const stream = open({ id: 'first' }, mobileUid)

        await expect(stream.events.next()).resolves.toEqual({ done: false, value: { id: 'first', payload: 'subscribed' } })
        await expect(openStreamCount()).resolves.toBe(1)

        subscribeAction.publish(mobileUid, { id: 'first', payload: 'published' })

        await expect(stream.events.next()).resolves.toEqual({ done: false, value: { id: 'first', payload: 'published' } })

        stream.cancel()

        await vi.waitFor(() => expect(closedConnectionsOf(mobileUid)).toHaveLength(1))
        expect(closedConnectionsOf(mobileUid)).toEqual([
            { headers: expect.objectContaining({ mobileUid }), request: { id: 'first' }, closedAt: expect.any(Number) },
        ])
        await expect(openStreamCount()).resolves.toBe(0)
    })

    it('should end the previous stream of a device that reconnects and publish only to the new one', async () => {
        const mobileUid = randomUUID()
        const previous = open({ id: 'previous' }, mobileUid)

        await previous.events.next()
        const current = open({ id: 'current' }, mobileUid)

        await current.events.next()

        await expect(previous.events.next()).resolves.toEqual({ done: true, value: undefined })

        subscribeAction.publish(mobileUid, { id: 'current', payload: 'published' })

        await expect(current.events.next()).resolves.toEqual({ done: false, value: { id: 'current', payload: 'published' } })
        current.cancel()
    })

    it('should unregister the stream when the action fails to handle its close', async () => {
        const mobileUid = randomUUID()
        const stream = open({ id: 'close', mode: 'throwOnClose' }, mobileUid)

        await stream.events.next()
        stream.cancel()

        await vi.waitFor(() => expect(closedConnectionsOf(mobileUid)).toHaveLength(1))
        await vi.waitFor(async () => await expect(openStreamCount()).resolves.toBe(0))
    })

    describe('with the end-stream-on-handler-error flag on', () => {
        beforeEach(() => {
            vi.spyOn(featureFlag, 'isEnabled').mockReturnValue(true)
        })

        it("should end the stream with the handler's error when it returns one", async () => {
            const stream = open({ id: 'error', mode: 'returnError' }, randomUUID())

            await expect(stream.events.next()).rejects.toMatchObject({ code: 500, message: expect.stringContaining('handler failed') })
        })

        it('should end the stream with the status and process code of an error the handler throws', async () => {
            const stream = open({ id: 'throw', mode: 'throw' }, randomUUID())

            await expect(stream.events.next()).rejects.toMatchObject({
                code: 403,
                data: expect.objectContaining({ processCode: subscribeTestProcessCode }),
            })
        })

        it('should send a response whose error field is unset', async () => {
            const stream = open({ id: 'ok' }, randomUUID())

            await expect(stream.events.next()).resolves.toEqual({ done: false, value: { id: 'ok', payload: 'subscribed' } })
            stream.cancel()
        })
    })

    describe('with the end-stream-on-handler-error flag off', () => {
        it("should send the handler's error as a message", async () => {
            const stream = open({ id: 'error', mode: 'returnError' }, randomUUID())

            await expect(stream.events.next()).resolves.toEqual({
                done: false,
                value: { id: 'error', payload: '', error: 'handler failed' },
            })
            stream.cancel()
        })

        it('should keep the stream open when the handler throws', async () => {
            const mobileUid = randomUUID()
            const stream = open({ id: 'throw', mode: 'throw' }, mobileUid)
            const next = stream.events.next()

            await vi.waitFor(() => expect(subscribeAction.openedConnections).toContainEqual(expect.objectContaining({ mobileUid })))
            subscribeAction.publish(mobileUid, { id: 'throw', payload: 'published' })

            await expect(next).resolves.toEqual({ done: false, value: { id: 'throw', payload: 'published' } })
            stream.cancel()
        })
    })

    it('should answer every message of a bidirectional stream and finish when the caller does', async () => {
        const messages = async function* (): AsyncGenerator<TestEvent> {
            yield { id: '1', payload: 'a' }
            yield { id: '2', payload: 'b' }
        }

        const responses: TestEvent[] = []

        for await (const response of client.chatTest(messages(), { deadline: 10_000 })) {
            responses.push(response)
        }

        expect(responses).toEqual([
            { id: '1', payload: 'echo: a' },
            { id: '2', payload: 'echo: b' },
        ])
    })
})
