import { randomUUID } from 'node:crypto'

import { HttpStatusCode, grpcMetadataKeys } from '@diia-inhouse/types'

import { CallOptions, GrpcMetadata, GrpcService } from '../../../src'
import SubscribeTestAction from '../actions/v1/subscribeTest'
import { TestClient } from '../generated'
import { getApp } from '../getApp'

describe('gRPC server shutdown', () => {
    it('should end open streams and wait for their close handlers before it stops serving', async () => {
        const app = await getApp()
        const client = app.container.resolve<TestClient<CallOptions>>('testServiceClient')
        const subscribeAction = app.container.resolve<SubscribeTestAction>('v1SubscribeTestAction')
        const mobileUid = randomUUID()
        const metadata = new GrpcMetadata()

        metadata.set(grpcMetadataKeys.MOBILE_UID, mobileUid)
        const events = client.subscribeTest({ id: 'stop', mode: 'slowClose' }, { metadata, deadline: 10_000 })[Symbol.asyncIterator]()

        await events.next()
        await expect(app.container.resolve<GrpcService>('grpcService').onHealthCheck()).resolves.toEqual({
            status: HttpStatusCode.OK,
            details: { grpcServer: 'SERVING' },
        })

        await app.stop()
        const stoppedAt = Date.now()

        await expect(events.next()).resolves.toEqual({ done: true, value: undefined })
        expect(subscribeAction.closedConnections).toEqual([
            {
                headers: expect.objectContaining({ mobileUid }),
                request: { id: 'stop', mode: 'slowClose' },
                closedAt: expect.any(Number),
            },
        ])
        expect(subscribeAction.closedConnections[0].closedAt).toBeLessThanOrEqual(stoppedAt)
        await expect(app.container.resolve<GrpcService>('grpcService').onHealthCheck()).resolves.toEqual({
            status: HttpStatusCode.SERVICE_UNAVAILABLE,
            details: { grpcServer: 'NOT_SERVING' },
        })
    })
})
