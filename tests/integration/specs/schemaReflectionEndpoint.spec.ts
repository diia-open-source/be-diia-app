import { once } from 'node:events'
import net, { AddressInfo } from 'node:net'

import { Metadata, status } from '@grpc/grpc-js'
import descriptorExt from 'protobufjs/ext/descriptor'

import { DiscoveredAction, SchemaReflectionClient } from '../../../src'
import { getApp } from '../getApp'
import { reflect } from '../serverReflection'

interface FieldDescriptor {
    name: string
    typeName?: string
}

interface MessageDescriptor {
    name: string
    field?: FieldDescriptor[]
    nestedType?: MessageDescriptor[]
    options?: { mapEntry?: boolean }
}

interface FileDescriptor {
    package: string
    messageType?: MessageDescriptor[]
    service?: { name: string; method: { name: string; inputType: string; outputType: string }[] }[]
}

const findMessage = (file: FileDescriptor, messagePath: string): MessageDescriptor | undefined => {
    let messages = file.messageType
    let message: MessageDescriptor | undefined

    for (const name of messagePath.split('.')) {
        message = messages?.find((candidate) => candidate.name === name)
        messages = message?.nestedType
    }

    return message
}

const unary = { requestStream: false, responseStream: false }

const boundActions: Partial<DiscoveredAction>[] = [
    { name: 'getTest', grpcMethod: '/ua.gov.diia.test.Test/GetTest', sessionType: 'User', ...unary },
    { name: 'getTestWithCtx', grpcMethod: '/ua.gov.diia.test.Test/GetTestWithCtx', sessionType: 'User,EResident', ...unary },
    { name: 'throwError', grpcMethod: '/ua.gov.diia.test.Test/ThrowError', sessionType: 'User', ...unary },
    { name: 'lockResource', grpcMethod: '/ua.gov.diia.test.Test/LockResource', sessionType: 'User', ...unary },
    { name: 'tryLockResource', grpcMethod: '/ua.gov.diia.test.Test/TryLockResource', sessionType: 'User', ...unary },
    { name: 'echoParams', grpcMethod: '/ua.gov.diia.test.Test/EchoParams', sessionType: 'None', ...unary },
    { name: 'echoContext', grpcMethod: '/ua.gov.diia.test.Test/EchoContext', sessionType: 'None', ...unary },
    { name: 'echoTypedParams', grpcMethod: '/ua.gov.diia.test.Test/EchoTypedParams', sessionType: 'None', ...unary },
    { name: 'echoTimestamp', grpcMethod: '/ua.gov.diia.test.Test/EchoTimestamp', sessionType: 'None', ...unary },
    { name: 'getVersioned', grpcMethod: '/ua.gov.diia.test.Test/GetVersioned', sessionType: 'None', ...unary },
    {
        name: 'subscribeTest',
        grpcMethod: '/ua.gov.diia.test.Test/SubscribeTest',
        sessionType: 'None',
        requestStream: false,
        responseStream: true,
    },
    { name: 'chatTest', grpcMethod: '/ua.gov.diia.test.Test/ChatTest', sessionType: 'None', requestStream: true, responseStream: true },
    { name: 'getTestPrivate', grpcMethod: '/ua.gov.diia.test.TestPrivate/GetTestPrivate', sessionType: 'User', ...unary },
]

const unusedPort = async (): Promise<number> => {
    const server = net.createServer().listen(0)

    await once(server, 'listening')
    const { port } = server.address() as AddressInfo

    server.close()
    await once(server, 'close')

    return port
}

describe('SchemaReflection endpoint', () => {
    let app: Awaited<ReturnType<typeof getApp>>
    let port: number

    beforeAll(async () => {
        app = await getApp()
        port = app.container.resolve('grpcServerPort')
    })

    afterAll(async () => {
        await app.stop()
    })

    describe('SchemaReflectionClient', () => {
        let address: string
        let client: SchemaReflectionClient

        beforeAll(() => {
            address = `localhost:${port}`
            client = new SchemaReflectionClient()
        })

        afterAll(() => {
            client.close()
        })

        it('should discover every action bound to a served gRPC method', async () => {
            const schema = await client.fetchSchema(address)

            expect({ ...schema, actions: schema?.actions.map(({ requestSchema, responseSchema, ...action }) => action) }).toEqual({
                serviceName: 'Auth',
                version: '',
                definitions: expect.any(Object),
                actions: boundActions.map((action) => ({
                    requestTypeName: expect.any(String),
                    responseTypeName: expect.any(String),
                    httpMapping: null,
                    description: '',
                    deprecated: false,
                    ...action,
                })),
            })
        })

        it('should describe enums, maps, nested messages, timestamps and cross-file types in a request schema', async () => {
            const schema = await client.fetchSchema(address)
            const echoTypedParams = schema?.actions.find(({ name }) => name === 'echoTypedParams')

            expect(echoTypedParams).toMatchObject({
                requestTypeName: 'TypedParams',
                responseTypeName: 'TypedParams',
                requestSchema: {
                    type: 'object',
                    properties: {
                        kind: { $ref: '#/definitions/Kind' },
                        kinds: { type: 'array', items: { $ref: '#/definitions/Kind' } },
                        inner: { $ref: '#/definitions/TypedParams.Inner' },
                        inners: { type: 'array', items: { $ref: '#/definitions/TypedParams.Inner' } },
                        labels: { type: 'object', additionalProperties: { type: 'string' } },
                        innerByKey: { type: 'object', additionalProperties: { $ref: '#/definitions/TypedParams.Inner' } },
                        count: { type: 'integer' },
                        big: { type: 'integer' },
                        flag: { type: 'boolean' },
                        at: { type: 'string', format: 'date-time', description: 'RFC 3339 formatted timestamp' },
                        userStatus: { $ref: '#/definitions/UserStatus' },
                        pairs: { type: 'array', items: { $ref: '#/definitions/TypedParams.Pair' } },
                        kindByKey: { type: 'object', additionalProperties: { $ref: '#/definitions/Kind' } },
                        nums: { type: 'array', items: { type: 'integer' } },
                    },
                    protoSource: expect.stringMatching(/^message TypedParams \{/),
                    required: ['kind', 'inner', 'labels', 'innerByKey', 'count', 'big', 'flag', 'at', 'userStatus', 'kindByKey'],
                },
            })
            expect(schema?.definitions).toMatchObject({
                Kind: { type: 'string', enum: ['KIND_UNSPECIFIED', 'KIND_A', 'KIND_B'], description: 'Kind' },
                'TypedParams.Inner': {
                    type: 'object',
                    properties: { kind: { $ref: '#/definitions/Kind' }, value: { type: 'string' } },
                    required: ['kind', 'value'],
                },
                'TypedParams.Pair': {
                    type: 'object',
                    properties: { key: { type: 'string' }, value: { type: 'string' } },
                    required: ['key', 'value'],
                },
                UserStatus: {
                    type: 'string',
                    enum: ['USER_STATUS_UNSPECIFIED', 'USER_STATUS_ACTIVE', 'USER_STATUS_INACTIVE', 'USER_STATUS_SUSPENDED'],
                    description: 'UserStatus\nUser status enumeration',
                },
            })
        })

        it("should describe an action's response schema", async () => {
            const schema = await client.fetchSchema(address)

            expect(schema?.actions.find(({ name }) => name === 'echoParams')?.responseSchema).toEqual({
                type: 'object',
                properties: { paramsJson: { type: 'string' } },
                protoSource: 'message EchoParamsRes {\n  string paramsJson = 1;\n}',
                required: ['paramsJson'],
            })
        })

        it('should return the same schema when called through the gateway proxy metadata', async () => {
            const metadata = new Metadata()

            metadata.set('service-id', 'auth')

            await expect(client.fetchSchema(address, metadata)).resolves.toEqual(await client.fetchSchema(address))
        })

        it.each([
            { description: 'without metadata', metadata: undefined },
            { description: 'with proxy metadata', metadata: new Metadata() },
        ])('should reject $description when nothing listens at the address', async ({ metadata }) => {
            await expect(client.fetchSchema(`localhost:${await unusedPort()}`, metadata)).rejects.toMatchObject({
                code: status.UNAVAILABLE,
            })
        })

        it('should fetch the schema again after close', async () => {
            const reopened = new SchemaReflectionClient()

            await reopened.fetchSchema(address)
            reopened.close()

            await expect(reopened.fetchSchema(address)).resolves.toMatchObject({ serviceName: 'Auth' })
            reopened.close()
        })
    })

    describe('server reflection', () => {
        const describeFiles = async (symbol: string): Promise<FileDescriptor[]> => {
            const response = await reflect(port, { file_containing_symbol: symbol })

            return (response.file_descriptor_response?.file_descriptor_proto ?? []).map(
                (buf) => descriptorExt.FileDescriptorProto.decode(buf).toJSON() as FileDescriptor,
            )
        }

        const describeFile = async (symbol: string): Promise<FileDescriptor> => {
            const files = await describeFiles(symbol)
            const [, packageName] = symbol.match(/^(.+)\.[^.]+$/) ?? []
            const file = files.find((descriptor) => descriptor.package === packageName)
            if (!file) {
                throw new Error(`No descriptor for ${symbol}`)
            }

            return file
        }

        it.each([
            { reference: 'a top-level message', message: 'EchoParamsReq', field: 'nested', typeName: '.ua.gov.diia.test.EchoNestedMsg' },
            {
                reference: 'a nested message of the same message',
                message: 'ThrowErrorReq',
                field: 'data',
                typeName: '.ua.gov.diia.test.ThrowErrorReq.ErrorData',
            },
            {
                reference: 'an enum from another file by a partial package',
                message: 'TypedParams',
                field: 'userStatus',
                typeName: '.ua.gov.diia.test.schema.UserStatus',
            },
            { reference: 'a well-known type', message: 'TypedParams', field: 'at', typeName: '.google.protobuf.Timestamp' },
            {
                reference: 'a top-level message named inside a nested message',
                message: 'Envelope.Entry',
                field: 'item',
                typeName: '.ua.gov.diia.test.EchoNestedMsg',
            },
            {
                reference: 'an enum nested in the same message',
                message: 'TypedParams',
                field: 'kind',
                typeName: '.ua.gov.diia.test.TypedParams.Kind',
            },
            {
                reference: 'an enum nested in the enclosing message',
                message: 'TypedParams.Inner',
                field: 'kind',
                typeName: '.ua.gov.diia.test.TypedParams.Kind',
            },
            {
                reference: 'a nested message used as a map value',
                message: 'TypedParams.InnerByKeyEntry',
                field: 'value',
                typeName: '.ua.gov.diia.test.TypedParams.Inner',
            },
            {
                reference: 'a nested enum used as a map value',
                message: 'TypedParams.KindByKeyEntry',
                field: 'value',
                typeName: '.ua.gov.diia.test.TypedParams.Kind',
            },
        ])('should fully qualify $reference', async ({ message, field, typeName }) => {
            const file = await describeFile('ua.gov.diia.test.Test')

            expect(findMessage(file, message)?.field?.find(({ name }) => name === field)?.typeName).toBe(typeName)
        })

        it.each([
            { field: 'metadata', entry: 'MetadataEntry' },
            { field: 'tag_counts', entry: 'TagCountsEntry' },
        ])(
            'should name the map entry of $field as protoc does and keep its bare name, which older gateways look up',
            async ({ field, entry }) => {
                const file = await describeFile('ua.gov.diia.test.schema.SchemaTestService')
                const user = findMessage(file, 'User')

                expect(user?.field?.find(({ name }) => name === field)?.typeName).toBe(entry)
                expect(user?.nestedType?.find(({ name }) => name === entry)?.options).toEqual({ mapEntry: true })
            },
        )
    })
})
