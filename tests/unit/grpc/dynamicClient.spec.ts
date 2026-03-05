import protobuf from 'protobufjs'
import { mock } from 'vitest-mock-extended'

import { Logger } from '@diia-inhouse/types'

import { DynamicGrpcClient } from '../../../src/grpc/dynamicClient'

vi.mock('@grpc/grpc-js', async (importOriginal) => {
    const original = await importOriginal<typeof import('@grpc/grpc-js')>()

    return {
        ...original,
        Client: vi.fn().mockImplementation(() => ({
            close: vi.fn(),
            makeUnaryRequest: vi.fn(),
        })),
        credentials: {
            createInsecure: vi.fn().mockReturnValue({}),
        },
        loadPackageDefinition: vi.fn().mockReturnValue({
            grpc: {
                reflection: {
                    v1: {
                        ServerReflection: vi.fn().mockImplementation(() => ({
                            close: vi.fn(),
                            ServerReflectionInfo: vi.fn(),
                        })),
                    },
                },
            },
        }),
    }
})

vi.mock('@grpc/proto-loader', () => ({
    loadSync: vi.fn().mockReturnValue({}),
}))

describe('DynamicGrpcClient', () => {
    const logger = mock<Logger>()
    let client: DynamicGrpcClient

    beforeEach(() => {
        vi.clearAllMocks()
        client = new DynamicGrpcClient(logger)
    })

    afterEach(() => {
        client.close()
    })

    describe('parseMethodPath', () => {
        it('throws error for invalid method format', async () => {
            await expect(
                client.call({
                    address: 'localhost:50051',
                    method: 'invalid-method',
                    body: {},
                }),
            ).rejects.toThrow('Invalid method format: invalid-method. Expected: /package.Service/Method')
        })

        it('throws error for method without leading slash', async () => {
            await expect(
                client.call({
                    address: 'localhost:50051',
                    method: 'package.Service/Method',
                    body: {},
                }),
            ).rejects.toThrow('Invalid method format')
        })

        it('throws error for method with trailing slash', async () => {
            await expect(
                client.call({
                    address: 'localhost:50051',
                    method: '/package.Service/Method/',
                    body: {},
                }),
            ).rejects.toThrow('Invalid method format')
        })
    })

    describe('close', () => {
        it('clears all caches and closes clients', () => {
            client.close()

            // Should not throw when called multiple times
            expect(() => client.close()).not.toThrow()
        })
    })
})

describe('DynamicGrpcClient method path parsing', () => {
    const logger = mock<Logger>()

    it('parses valid method paths correctly', () => {
        const client = new DynamicGrpcClient(logger)

        // Access private method via prototype for testing
        const parseMethodPath = (
            client as unknown as { parseMethodPath: (m: string) => { serviceName: string; methodName: string } }
        ).parseMethodPath.bind(client)

        expect(parseMethodPath('/ua.gov.diia.Service/GetUser')).toEqual({
            serviceName: 'ua.gov.diia.Service',
            methodName: 'GetUser',
        })

        expect(parseMethodPath('/simple.Svc/Do')).toEqual({
            serviceName: 'simple.Svc',
            methodName: 'Do',
        })

        client.close()
    })
})

describe('DynamicGrpcClient enum conversion', () => {
    const logger = mock<Logger>()

    it('converts string enum values to numeric values', () => {
        const client = new DynamicGrpcClient(logger)

        const root = new protobuf.Root()
        const namespace = new protobuf.Namespace('test')

        root.add(namespace)

        const ownerTypeEnum = new protobuf.Enum('OwnerType', {
            owner: 0,
            properUser: 1,
        })

        namespace.add(ownerTypeEnum)

        const requestType = new protobuf.Type('TestRequest')

        requestType.add(new protobuf.Field('ownerType', 1, 'OwnerType'))
        requestType.add(new protobuf.Field('version', 2, 'int32'))
        namespace.add(requestType)

        requestType.resolveAll()

        // Access private method for testing
        const convertEnumValues = (
            client as unknown as { convertEnumValues: (type: protobuf.Type, body: object) => object }
        ).convertEnumValues.bind(client)

        const result = convertEnumValues(requestType, {
            ownerType: 'properUser',
            version: 0,
        })

        expect(result).toEqual({
            ownerType: 1,
            version: 0,
        })

        client.close()
    })

    it('handles already numeric enum values', () => {
        const client = new DynamicGrpcClient(logger)

        const root = new protobuf.Root()
        const namespace = new protobuf.Namespace('test')

        root.add(namespace)

        const statusEnum = new protobuf.Enum('Status', {
            pending: 0,
            active: 1,
            closed: 2,
        })

        namespace.add(statusEnum)

        const requestType = new protobuf.Type('TestRequest')

        requestType.add(new protobuf.Field('status', 1, 'Status'))
        namespace.add(requestType)

        requestType.resolveAll()

        const convertEnumValues = (
            client as unknown as { convertEnumValues: (type: protobuf.Type, body: object) => object }
        ).convertEnumValues.bind(client)

        const result = convertEnumValues(requestType, {
            status: 2,
        })

        expect(result).toEqual({
            status: 2,
        })

        client.close()
    })

    it('converts enum values in nested messages', () => {
        const client = new DynamicGrpcClient(logger)

        const root = new protobuf.Root()
        const namespace = new protobuf.Namespace('test')

        root.add(namespace)

        const typeEnum = new protobuf.Enum('Type', {
            typeA: 0,
            typeB: 1,
        })

        namespace.add(typeEnum)

        const nestedType = new protobuf.Type('NestedMessage')

        nestedType.add(new protobuf.Field('type', 1, 'Type'))
        namespace.add(nestedType)

        const requestType = new protobuf.Type('TestRequest')

        requestType.add(new protobuf.Field('nested', 1, 'NestedMessage'))
        namespace.add(requestType)

        root.resolveAll()

        const convertEnumValues = (
            client as unknown as { convertEnumValues: (type: protobuf.Type, body: object) => object }
        ).convertEnumValues.bind(client)

        const result = convertEnumValues(requestType, {
            nested: {
                type: 'typeB',
            },
        })

        expect(result).toEqual({
            nested: {
                type: 1,
            },
        })

        client.close()
    })

    it('converts enum values in repeated fields', () => {
        const client = new DynamicGrpcClient(logger)

        const root = new protobuf.Root()
        const namespace = new protobuf.Namespace('test')

        root.add(namespace)

        const statusEnum = new protobuf.Enum('Status', {
            pending: 0,
            active: 1,
            closed: 2,
        })

        namespace.add(statusEnum)

        const requestType = new protobuf.Type('TestRequest')
        const statusField = new protobuf.Field('statuses', 1, 'Status', 'repeated')

        requestType.add(statusField)
        namespace.add(requestType)

        requestType.resolveAll()

        const convertEnumValues = (
            client as unknown as { convertEnumValues: (type: protobuf.Type, body: object) => object }
        ).convertEnumValues.bind(client)

        const result = convertEnumValues(requestType, {
            statuses: ['pending', 'active', 'closed'],
        })

        expect(result).toEqual({
            statuses: [0, 1, 2],
        })

        client.close()
    })
})
