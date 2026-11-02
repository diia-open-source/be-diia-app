import { once } from 'node:events'
import net, { AddressInfo } from 'node:net'
import path from 'node:path'

import { ChannelCredentials, ClientDuplexStream, ServiceClientConstructor, loadPackageDefinition, status } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import descriptorExt from 'protobufjs/ext/descriptor'
import { mock } from 'vitest-mock-extended'

import type { EnvService } from '@diia-inhouse/env'
import { type HealthCheck, protoPath as healthProtoPath } from '@diia-inhouse/healthcheck'
import type { Logger } from '@diia-inhouse/types'

import { GrpcClientFactory } from '../../../src'
import { GrpcServer } from '../../../src/grpc/server'
import { TestClient, TestPrivateClient } from '../generated'
import { TestDefinition, TestPrivateDefinition } from '../generated/test-service'
import { getApp } from '../getApp'

interface ServerReflectionRequest {
    list_services?: string
    file_containing_symbol?: string
}

interface ServerReflectionResponse {
    list_services_response?: { service: { name: string }[] }
    file_descriptor_response?: { file_descriptor_proto: Buffer[] }
    error_response?: { error_code: number }
}

interface ServerReflectionClient {
    ServerReflectionInfo: () => ClientDuplexStream<ServerReflectionRequest, ServerReflectionResponse>
    close: () => void
}

interface SchemaReflectionClient {
    getSchemas: (request: object, callback: (error: (Error & { code: number }) | null) => void) => void
    close: () => void
}

interface HealthClient {
    Check: (request: { service: string }, callback: (error: Error | null, response?: { status: string }) => void) => void
    close: () => void
}

const loadService = (protoPath: string, servicePath: string[]): ServiceClientConstructor => {
    let definition: unknown = loadPackageDefinition(loadSync(protoPath, { keepCase: true, enums: String }))
    for (const key of servicePath) {
        definition = (definition as Record<string, unknown>)[key]
    }

    return definition as ServiceClientConstructor
}

const ServerReflection = loadService(
    path.resolve(__dirname, '../../../node_modules/@grpc/reflection/build/proto/grpc/reflection/v1/reflection.proto'),
    ['grpc', 'reflection', 'v1', 'ServerReflection'],
)

const SchemaReflection = loadService(path.resolve(__dirname, '../../../proto/schema-reflection.proto'), [
    'diia',
    'schema',
    'v1',
    'SchemaReflection',
])

const Health = loadService(healthProtoPath, ['grpc', 'health', 'v1', 'Health'])

const reflect = async (port: number, request: ServerReflectionRequest): Promise<ServerReflectionResponse> => {
    const client = new ServerReflection(`localhost:${port}`, ChannelCredentials.createInsecure()) as unknown as ServerReflectionClient
    const call = client.ServerReflectionInfo()
    const { promise, resolve, reject } = Promise.withResolvers<ServerReflectionResponse>()

    call.on('data', resolve)
    call.on('error', reject)
    call.write(request)

    try {
        return await promise
    } finally {
        call.end()
        client.close()
    }
}

const listServices = async (port: number): Promise<string[] | undefined> => {
    const response = await reflect(port, { list_services: '*' })

    return response.list_services_response?.service.map(({ name }) => name)
}

const describeServices = async (port: number, symbol: string): Promise<string[] | undefined> => {
    const response = await reflect(port, { file_containing_symbol: symbol })

    return response.file_descriptor_response?.file_descriptor_proto.flatMap(
        (buf) =>
            descriptorExt.FileDescriptorProto.decode(buf)
                .toJSON()
                .service?.map(({ name }: { name: string }) => name) ?? [],
    )
}

const getSchemasErrorCode = async (port: number): Promise<number | undefined> => {
    const client = new SchemaReflection(`localhost:${port}`, ChannelCredentials.createInsecure()) as unknown as SchemaReflectionClient
    const { promise, resolve } = Promise.withResolvers<number | undefined>()

    client.getSchemas({}, (error) => resolve(error?.code))

    try {
        return await promise
    } finally {
        client.close()
    }
}

const checkHealth = async (port: number): Promise<string | undefined> => {
    const client = new Health(`localhost:${port}`, ChannelCredentials.createInsecure()) as unknown as HealthClient
    const { promise, resolve, reject } = Promise.withResolvers<string | undefined>()

    client.Check({ service: '' }, (error, response) => (error ? reject(error) : resolve(response?.status)))

    try {
        return await promise
    } finally {
        client.close()
    }
}

const listen = async (port = 0): Promise<net.Server> => {
    const server = net.createServer().listen(port, '0.0.0.0')

    await once(server, 'listening')

    return server
}

const close = async (server: net.Server): Promise<void> => {
    server.close()
    await once(server, 'close')
}

const reserveFreePort = async (): Promise<number> => {
    const server = await listen()
    const { port } = server.address() as AddressInfo

    await close(server)

    return port
}

const connect = async (port: number): Promise<void> => {
    const socket = net.connect(port, '127.0.0.1')

    await once(socket, 'connect')
    socket.destroy()
}

describe('grpc services on their own ports', () => {
    let app: Awaited<ReturnType<typeof getApp>>
    let isStopped = false

    let defaultPort: number
    let extraPort: number

    let testClient: TestClient
    let testPrivateClient: TestPrivateClient
    let extraPortTestClient: TestClient
    let extraPortTestPrivateClient: TestPrivateClient

    beforeAll(async () => {
        extraPort = await reserveFreePort()
        vi.stubEnv(
            'GRPC_SERVICES',
            JSON.stringify(['ua.gov.diia.test.Test', 'ua.gov.diia.test.TestPrivate', { name: 'ua.gov.diia.test.Test', port: extraPort }]),
        )

        app = await getApp()
        defaultPort = app.container.resolve('grpcServerPort')
        testClient = app.container.resolve('testServiceClient')
        testPrivateClient = app.container.resolve('testPrivateServiceClient')

        const grpcClientFactory = app.container.resolve<GrpcClientFactory>('grpcClientFactory')

        extraPortTestClient = grpcClientFactory.createGrpcClient(TestDefinition, `localhost:${extraPort}`)
        extraPortTestPrivateClient = grpcClientFactory.createGrpcClient(TestPrivateDefinition, `localhost:${extraPort}`)
    })

    afterAll(async () => {
        vi.unstubAllEnvs()
        if (!isStopped) {
            await app?.stop()
        }
    })

    it('serves both services on the default port', async () => {
        const result = await Promise.all([testClient.getTest({ timeoutMs: 1 }), testPrivateClient.getTestPrivate({ timeoutMs: 1 })])

        expect(result).toEqual([{ status: 'ok' }, { status: 'ok' }])
    })

    it('serves only the bound service on the extra port', async () => {
        await expect(extraPortTestClient.getTest({ timeoutMs: 1 })).resolves.toEqual({ status: 'ok' })
        await expect(extraPortTestPrivateClient.getTestPrivate({ timeoutMs: 1 })).rejects.toMatchObject({ code: status.UNIMPLEMENTED })
    })

    it('lists every service in default-port reflection', async () => {
        const services = await listServices(defaultPort)

        expect(services).toEqual(expect.arrayContaining(['ua.gov.diia.test.Test', 'ua.gov.diia.test.TestPrivate']))
    })

    it('lists only bound services in extra-port reflection', async () => {
        const services = await listServices(extraPort)

        expect(services).toEqual(['ua.gov.diia.test.Test'])
    })

    it('describes only bound services in extra-port reflection', async () => {
        await expect(describeServices(extraPort, 'ua.gov.diia.test.Test')).resolves.toEqual(['Test'])
        await expect(reflect(extraPort, { file_containing_symbol: 'ua.gov.diia.test.TestPrivate' })).resolves.toMatchObject({
            error_response: { error_code: status.NOT_FOUND },
        })
    })

    it('serves SchemaReflection on the default port only', async () => {
        await expect(getSchemasErrorCode(defaultPort)).resolves.toBeUndefined()
        await expect(getSchemasErrorCode(extraPort)).resolves.toBe(status.UNIMPLEMENTED)
    })

    it('closes every port on stop', async () => {
        await app.stop()
        isStopped = true

        await expect(connect(defaultPort)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
        await expect(connect(extraPort)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    })
})

describe('grpc server with a taken port', () => {
    it('closes the bound ports and rejects', async () => {
        const blocker = await listen()
        const { port: busyPort } = blocker.address() as AddressInfo
        const defaultPort = await reserveFreePort()
        const server = new GrpcServer(
            {
                isEnabled: true,
                port: defaultPort,
                services: ['ua.gov.diia.test.Test', { name: 'ua.gov.diia.test.Test', port: busyPort }],
                isReflectionEnabled: false,
                maxReceiveMessageLength: 4 * 1024 * 1024,
            },
            mock<Logger>(),
            mock<EnvService>(),
            undefined,
        )

        try {
            await expect(server.start(() => ({}))).rejects.toThrow(/No address added/)

            expect(server.getStatus()).toBe('UNKNOWN')
            await expect(connect(defaultPort)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
        } finally {
            await close(blocker)
        }
    })
})

describe('grpc server with health checks', () => {
    it('serves and reflects health on the extra port', async () => {
        const extraPort = await reserveFreePort()
        const healthCheck = mock<HealthCheck>()
        const envService = mock<EnvService>()

        healthCheck.healthcheck.mockResolvedValue({ isHealthy: true, details: {} })
        envService.isProd.mockReturnValue(false)
        const server = new GrpcServer(
            {
                isEnabled: true,
                port: 0,
                services: ['ua.gov.diia.test.Test', { name: 'ua.gov.diia.test.Test', port: extraPort }],
                isReflectionEnabled: true,
                maxReceiveMessageLength: 4 * 1024 * 1024,
            },
            mock<Logger>(),
            envService,
            healthCheck,
        )

        await server.start(() => ({}))
        try {
            await expect(checkHealth(extraPort)).resolves.toBe('SERVING')
            await expect(listServices(extraPort)).resolves.toEqual(['ua.gov.diia.test.Test', 'grpc.health.v1.Health'])
        } finally {
            await server.stop()
        }
    })
})
