import { once } from 'node:events'
import net, { AddressInfo } from 'node:net'
import path from 'node:path'

import { Server, ServerCredentials, UntypedServiceImplementation } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import { ReflectionService } from '@grpc/reflection'
import descriptorExt from 'protobufjs/ext/descriptor'

import type { Logger } from '@diia-inhouse/types'

import { GrpcExecuteResult, GrpcExecutor } from '../../../src'
import { getApp } from '../getApp'
import { loadService } from '../serverReflection'

const emptyTypedParams = {
    kind: 'KIND_UNSPECIFIED',
    kinds: [],
    inner: null,
    inners: [],
    labels: {},
    innerByKey: {},
    count: 0,
    big: '0',
    flag: false,
    at: null,
    userStatus: 'USER_STATUS_UNSPECIFIED',
    pairs: [],
    kindByKey: {},
    nums: [],
}

interface MessageDescriptor {
    name: string
    field?: { name: string; typeName?: string }[]
    nestedType?: (MessageDescriptor & { options?: { mapEntry?: boolean } })[]
}

const withoutPayloadFile = (files: Buffer[]): Buffer[] =>
    files.filter((buf) => descriptorExt.FileDescriptorProto.decode(buf).toJSON().name !== 'ua_gov_diia_fixture_payload.proto')

/** protoc references a map entry by its full name; proto-loader by the bare name of a nested type */
const withMapEntriesNamedInFull = (files: Buffer[]): Buffer[] =>
    files.map((buf) => {
        const file = descriptorExt.FileDescriptorProto.decode(buf).toJSON() as { package: string; messageType?: MessageDescriptor[] }

        for (const message of file.messageType ?? []) {
            for (const field of message.field ?? []) {
                const entry = message.nestedType?.find(({ name, options }) => options?.mapEntry && name === field.typeName)

                if (entry) {
                    entry.name = `${entry.name}Entry`
                    field.typeName = `.${file.package}.${message.name}.${entry.name}`
                }
            }
        }

        return Buffer.from(descriptorExt.FileDescriptorProto.encode(descriptorExt.FileDescriptorProto.fromObject(file)).finish())
    })

const serveFixture = async (
    protoFile: string,
    servicePath: string[],
    implementation: UntypedServiceImplementation,
    reflectFiles: (files: Buffer[]) => Buffer[],
): Promise<{ server: Server; port: number }> => {
    const protoPath = path.resolve(__dirname, '../fixtures/proto', protoFile)
    const pkgDefs = loadSync(protoPath)
    const reflected = Object.fromEntries(
        Object.entries(pkgDefs).map(([name, definition]) => [
            name,
            'fileDescriptorProtos' in definition && Array.isArray(definition.fileDescriptorProtos)
                ? { ...definition, fileDescriptorProtos: reflectFiles(definition.fileDescriptorProtos) }
                : definition,
        ]),
    ) as typeof pkgDefs
    const server = new Server()

    server.addService(loadService(protoPath, servicePath).service, implementation)
    new ReflectionService(reflected).addToServer(server)
    const { promise, resolve, reject } = Promise.withResolvers<number>()

    server.bindAsync('localhost:0', ServerCredentials.createInsecure(), (err, port) => (err ? reject(err) : resolve(port)))

    return { server, port: await promise }
}

describe('GrpcExecutor', () => {
    let app: Awaited<ReturnType<typeof getApp>>
    let address: string
    let executor: GrpcExecutor

    const createExecutor = (
        baseMetadata: Record<string, string> = {},
        options?: ConstructorParameters<typeof GrpcExecutor>[2],
    ): GrpcExecutor =>
        new GrpcExecutor(
            {
                getServiceAddress: (serviceId) => {
                    if (serviceId !== 'test') {
                        throw new Error(`Service ${serviceId} not found in config`)
                    }

                    return address
                },
                createBaseMetadata: () => baseMetadata,
            },
            app.container.resolve<Logger>('logger'),
            options,
        )

    beforeAll(async () => {
        app = await getApp()
        address = `localhost:${app.container.resolve('grpcServerPort')}`
        executor = createExecutor()
    })

    afterAll(async () => {
        executor.close()
        await app.stop()
    })

    it.each([
        {
            description: 'scalars sent as query-string text',
            body: { count: '42', flag: 'true', big: '9000' },
            expected: { count: 42, flag: true, big: '9000' },
        },
        { description: 'an enum value given by name', body: { kind: 'KIND_B' }, expected: { kind: 'KIND_B' } },
        { description: 'an enum value given by number', body: { kind: 2 }, expected: { kind: 'KIND_B' } },
        { description: 'repeated enum values', body: { kinds: ['KIND_A', 'KIND_B'] }, expected: { kinds: ['KIND_A', 'KIND_B'] } },
        {
            description: 'an enum inside a nested message',
            body: { inner: { kind: 'KIND_A', value: 'v' } },
            expected: { inner: { kind: 'KIND_A', value: 'v' } },
        },
        {
            description: 'repeated nested messages',
            body: { inners: [{ kind: 'KIND_B', value: 'x' }] },
            expected: { inners: [{ kind: 'KIND_B', value: 'x' }] },
        },
        { description: 'a map of strings', body: { labels: { a: 'x', b: 'y' } }, expected: { labels: { a: 'x', b: 'y' } } },
        {
            description: 'a map of messages',
            body: { innerByKey: { k: { kind: 1, value: 'v' } } },
            expected: { innerByKey: { k: { kind: 'KIND_A', value: 'v' } } },
        },
        {
            description: 'enum names as map values',
            body: { kindByKey: { a: 'KIND_A', b: 'KIND_B' } },
            expected: { kindByKey: { a: 'KIND_A', b: 'KIND_B' } },
        },
        {
            description: 'an enum name inside a map of messages',
            body: { innerByKey: { k: { kind: 'KIND_B', value: 'v' } } },
            expected: { innerByKey: { k: { kind: 'KIND_B', value: 'v' } } },
        },
        { description: 'repeated numbers sent as query-string text', body: { nums: ['1', '2'] }, expected: { nums: [1, 2] } },
        { description: 'a single query-string value for a repeated field', body: { nums: '3' }, expected: { nums: [3] } },
        { description: 'an int64 beyond double precision', body: { big: '9007199254740993' }, expected: { big: '9007199254740993' } },
        {
            description: 'an enum declared in another proto file',
            body: { userStatus: 'USER_STATUS_ACTIVE' },
            expected: { userStatus: 'USER_STATUS_ACTIVE' },
        },
        {
            description: 'a Timestamp given as seconds and nanos',
            body: { at: { seconds: 1700000000, nanos: 500000000 } },
            expected: { at: new Date('2023-11-14T22:13:20.500Z') },
        },
    ])('should deliver $description and decode the echoed response', async ({ body, expected }) => {
        const result = await executor.execute({ serviceId: 'test', grpcMethod: '/ua.gov.diia.test.Test/EchoTypedParams', body })

        expect(result).toEqual<GrpcExecuteResult>({ success: true, data: { ...emptyTypedParams, ...expected } })
    })

    it('should forward base and custom metadata to the action, custom values winning and empty values dropped', async () => {
        const session = { sessionType: 'User', user: { identifier: 'user-1' } }
        const result = await createExecutor({ traceid: 'base-trace', 'sent-from': 'gateway', 'service-id': 'test' }).execute({
            serviceId: 'test',
            grpcMethod: '/ua.gov.diia.test.Test/EchoContext',
            body: {},
            metadata: {
                traceid: 'custom-trace',
                mobileuid: 'mobile-1',
                acceptlanguage: '',
                session: Buffer.from(JSON.stringify(session)).toString('base64'),
            },
        })

        expect(result).toEqual<GrpcExecuteResult>({
            success: true,
            data: { headersJson: expect.any(String), sessionJson: JSON.stringify(session) },
        })
        expect(JSON.parse((result.data as { headersJson: string }).headersJson)).toEqual({
            actionVersion: 'v1',
            traceId: 'custom-trace',
            mobileUid: 'mobile-1',
            sentFrom: 'gateway',
        })
    })

    it.each([
        {
            description: 'the method path has no leading slash',
            grpcMethod: 'ua.gov.diia.test.Test/EchoParams',
            message: 'Invalid method format: ua.gov.diia.test.Test/EchoParams. Expected: /package.Service/Method',
        },
        {
            description: 'the method path has a trailing slash',
            grpcMethod: '/ua.gov.diia.test.Test/EchoParams/',
            message: 'Invalid method format: /ua.gov.diia.test.Test/EchoParams/. Expected: /package.Service/Method',
        },
        {
            description: 'the method path has no method',
            grpcMethod: 'invalid-method',
            message: 'Invalid method format: invalid-method. Expected: /package.Service/Method',
        },
        {
            description: 'the service has no such method',
            grpcMethod: '/ua.gov.diia.test.Test/Nope',
            message: 'Method Nope not found in service ua.gov.diia.test.Test',
        },
        {
            description: 'the server does not know the service',
            grpcMethod: '/ua.gov.diia.test.Nope/Get',
            message: 'Reflection error: Symbol not found: ua.gov.diia.test.Nope',
        },
        {
            description: 'the body does not match the request type',
            grpcMethod: '/ua.gov.diia.test.Test/EchoTypedParams',
            body: { inner: 'x' },
            message: 'Request validation failed: inner.object expected',
        },
    ])('should return an error result when $description', async ({ grpcMethod, body = {}, message }) => {
        const result = await executor.execute({ serviceId: 'test', grpcMethod, body })

        expect(result).toEqual<GrpcExecuteResult>({ success: false, error: { message, metadata: undefined } })
    })

    it('should return an error result when the service address is unknown', async () => {
        const result = await executor.execute({ serviceId: 'unknown', grpcMethod: '/ua.gov.diia.test.Test/EchoParams', body: {} })

        expect(result).toEqual<GrpcExecuteResult>({
            success: false,
            error: { message: 'Service unknown not found in config', metadata: undefined },
        })
    })

    it.each([
        { description: 'plain text', text: 'not found' },
        { description: 'quotes and a line break', text: 'Document "passport"\nnot found' },
    ])("should return the action's error with its original error and process code when its data holds $description", async ({ text }) => {
        const result = await executor.execute({
            serviceId: 'test',
            grpcMethod: '/ua.gov.diia.test.Test/ThrowError',
            body: { httpStatus: 404, processCode: 1010, type: 'operated', data: { description: text } },
        })

        expect(result).toEqual<GrpcExecuteResult>({
            success: false,
            error: {
                message: '5 NOT_FOUND: error message',
                metadata: {
                    'content-type': 'application/grpc+proto',
                    date: expect.any(String),
                    'handled-by': 'Auth',
                    processcode: '1010',
                    'original-error': {
                        name: 'Error',
                        message: 'error message',
                        code: 404,
                        type: 'operated',
                        data: { code: 404, description: text, processCode: 1010 },
                    },
                },
            },
        })
    })

    it('should return an error result when nothing listens at the address', async () => {
        const server = net.createServer().listen(0)

        await once(server, 'listening')
        const { port } = server.address() as AddressInfo

        server.close()
        await once(server, 'close')
        const closedPortExecutor = createExecutor()

        address = `localhost:${port}`

        try {
            const result = await closedPortExecutor.execute({
                serviceId: 'test',
                grpcMethod: '/ua.gov.diia.test.Test/EchoParams',
                body: {},
            })

            expect(result).toEqual<GrpcExecuteResult>({
                success: false,
                error: { message: expect.stringMatching(/^14 UNAVAILABLE: /), metadata: undefined },
            })
        } finally {
            address = `localhost:${app.container.resolve('grpcServerPort')}`
            closedPortExecutor.close()
        }
    })

    it('should give up on reflection after the configured timeout', async () => {
        const sockets = new Set<net.Socket>()
        const server = net.createServer((socket) => sockets.add(socket)).listen(0)

        await once(server, 'listening')
        const { port } = server.address() as AddressInfo
        const slowExecutor = createExecutor({}, { reflectionTimeoutMs: 200 })

        address = `localhost:${port}`

        try {
            const result = await slowExecutor.execute({ serviceId: 'test', grpcMethod: '/ua.gov.diia.test.Test/EchoParams', body: {} })

            expect(result).toEqual<GrpcExecuteResult>({
                success: false,
                error: { message: 'Reflection timeout after 200ms for symbol ua.gov.diia.test.Test', metadata: undefined },
            })
        } finally {
            address = `localhost:${app.container.resolve('grpcServerPort')}`
            slowExecutor.close()
            for (const socket of sockets) {
                socket.destroy()
            }

            server.close()
        }
    })

    it('should call services from different proto files on one address', async () => {
        const echo = await executor.execute({ serviceId: 'test', grpcMethod: '/ua.gov.diia.test.Test/EchoParams', body: { name: 'a' } })
        const schemas = await executor.execute({ serviceId: 'test', grpcMethod: '/diia.schema.v1.SchemaReflection/GetSchemas', body: {} })

        expect(echo).toEqual<GrpcExecuteResult>({ success: true, data: { paramsJson: '{"items":[],"name":"a"}' } })
        expect(schemas).toMatchObject({ success: true, data: { serviceName: 'Auth' } })
    })

    it("should decode a field whose type the server's reflection omits as an empty object", async () => {
        const { server, port } = await serveFixture(
            'payload-service.proto',
            ['ua', 'gov', 'diia', 'fixture', 'PayloadService'],
            {
                getPayload: (_: unknown, callback: (err: null, res: object) => void) =>
                    callback(null, { name: 'n', payload: { value: 'v' } }),
            },
            withoutPayloadFile,
        )
        const fixtureExecutor = createExecutor()

        address = `localhost:${port}`

        try {
            const result = await fixtureExecutor.execute({
                serviceId: 'test',
                grpcMethod: '/ua.gov.diia.fixture.PayloadService/GetPayload',
                body: {},
            })

            expect(result).toEqual<GrpcExecuteResult>({ success: true, data: { name: 'n', payload: {} } })
        } finally {
            address = `localhost:${app.container.resolve('grpcServerPort')}`
            fixtureExecutor.close()
            server.forceShutdown()
        }
    })

    it.each([
        { description: 'a map whose entry the server names in full, as protoc does', body: { labels: { a: 'x' } } },
        { description: 'a list of key-value messages that is not a map', body: { pairs: [{ key: 'k', value: 'v' }] } },
    ])('should deliver $description and decode the echoed response', async ({ body }) => {
        const { server, port } = await serveFixture(
            'map-service.proto',
            ['ua', 'gov', 'diia', 'fixture', 'maps', 'MapService'],
            { echo: ({ request }: { request: object }, callback: (err: null, res: object) => void) => callback(null, request) },
            withMapEntriesNamedInFull,
        )
        const fixtureExecutor = createExecutor()

        address = `localhost:${port}`

        try {
            const result = await fixtureExecutor.execute({
                serviceId: 'test',
                grpcMethod: '/ua.gov.diia.fixture.maps.MapService/Echo',
                body,
            })

            expect(result).toEqual<GrpcExecuteResult>({ success: true, data: { labels: {}, pairs: [], ...body } })
        } finally {
            address = `localhost:${app.container.resolve('grpcServerPort')}`
            fixtureExecutor.close()
            server.forceShutdown()
        }
    })

    it('should call the service again after close', async () => {
        const reopened = createExecutor()
        const call = async (): Promise<GrpcExecuteResult> =>
            await reopened.execute({ serviceId: 'test', grpcMethod: '/ua.gov.diia.test.Test/EchoParams', body: { name: 'a' } })

        await call()
        reopened.close()

        await expect(call()).resolves.toEqual<GrpcExecuteResult>({ success: true, data: { paramsJson: '{"items":[],"name":"a"}' } })
        reopened.close()
    })
})
