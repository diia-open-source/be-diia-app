import { status as Status } from '@grpc/grpc-js'
import { ChannelCredentials, createChannel, createClient } from 'nice-grpc'

import { TestClient } from '../generated'
import { TestDefinition } from '../generated/test-service'
import { getApp } from '../getApp'
import { tlsConfigFactory } from '../mocks/grpc/tls/config'

describe('grpcTls', () => {
    let app: Awaited<ReturnType<typeof getApp>>
    let testServiceClient: TestClient
    let serverPort: number

    beforeAll(async () => {
        app = await getApp(tlsConfigFactory)
        testServiceClient = app.container.resolve('testServiceClient')
        serverPort = app.container.resolve('grpcServerPort')
    })

    afterAll(async () => {
        await app.stop()
    })

    it('should complete a real mTLS handshake and serve a request', async () => {
        const result = await testServiceClient.getTest({ timeoutMs: 1 })

        expect(result).toEqual({ status: 'ok' })
    })

    it('should reject a plain-text client that does not use TLS', async () => {
        const insecureChannel = createChannel(`localhost:${serverPort}`, ChannelCredentials.createInsecure())
        const insecureClient = createClient(TestDefinition, insecureChannel)

        await expect(insecureClient.getTest({ timeoutMs: 1 })).rejects.toMatchObject({ code: Status.UNAVAILABLE })
    })
})
