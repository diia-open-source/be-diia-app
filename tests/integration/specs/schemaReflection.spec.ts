import path from 'node:path'

import { load } from '@grpc/proto-loader'

import {
    JsonSchemaGenerator,
    ProtoMetadataExtractor,
    SchemaReflectionInitializer,
    SchemaRegistry,
} from '../../../src/grpc/schemaReflection'

const resolvePackageDir = (packageName: string): string => {
    const packageJsonPath = require.resolve(`${packageName}/package.json`)

    return path.dirname(packageJsonPath)
}

const withoutProtoSource = (schema: object): object =>
    JSON.parse(JSON.stringify(schema, (key, value) => (key === 'protoSource' ? undefined : value)))

const getUserRequestSchema = {
    type: 'object',
    properties: {
        id: { type: 'string', description: 'User ID in UUID format' },
        include_profile: { type: 'boolean', description: 'Include profile' },
    },
    description: 'Request to get user by ID',
    required: ['id'],
}

const treeNodeProperties = {
    id: { type: 'string' },
    value: { type: 'string' },
    parent: { $ref: '#/definitions/TreeNode' },
    children: { type: 'array', items: { $ref: '#/definitions/TreeNode' } },
}

const categoryProperties = {
    id: { type: 'string' },
    name: { type: 'string' },
    products: { type: 'array', items: { $ref: '#/definitions/Product' } },
    subcategories: { type: 'array', items: { $ref: '#/definitions/Category' } },
}

const userProperties = {
    id: { type: 'string', description: 'Unique identifier' },
    email: { type: 'string', description: "User's email address" },
    name: { type: 'string', description: 'Full name' },
    status: { $ref: '#/definitions/UserStatus', description: 'Status' },
    profile: { $ref: '#/definitions/UserProfile', description: 'Profile' },
    roles: { type: 'array', items: { $ref: '#/definitions/UserRole', description: 'Roles' } },
    created_at: { type: 'string', description: 'Account creation date in DD.MM.YYYY format' },
    addresses: { type: 'array', items: { $ref: '#/definitions/Address', description: 'Addresses' } },
    metadata: { type: 'object', additionalProperties: { type: 'string' }, description: 'Metadata (map type)' },
    tag_counts: { type: 'object', additionalProperties: { type: 'integer' }, description: 'Tag counts (map type)' },
}

const userDefinitions = {
    UserStatus: {
        type: 'string',
        enum: ['USER_STATUS_UNSPECIFIED', 'USER_STATUS_ACTIVE', 'USER_STATUS_INACTIVE', 'USER_STATUS_SUSPENDED'],
        description: 'UserStatus\nUser status enumeration',
    },
    UserProfile: {
        type: 'object',
        properties: {
            phone: { type: 'string' },
            avatar_url: { type: 'string' },
            settings: { $ref: '#/definitions/ProfileSettings', description: 'Settings' },
            metadata: { $ref: '#/definitions/ProfileMetadata', description: 'Nested metadata' },
        },
        description: 'UserProfile\nUser profile',
        required: ['settings', 'metadata'],
    },
    ProfileSettings: {
        type: 'object',
        properties: { notifications_enabled: { type: 'boolean' }, language: { type: 'string' }, timezone: { type: 'string' } },
        description: 'ProfileSettings\nProfile settings',
        required: ['notifications_enabled', 'language'],
    },
    ProfileMetadata: {
        type: 'object',
        properties: {
            last_login: { type: 'integer' },
            login_count: { type: 'integer' },
            devices: { type: 'array', items: { $ref: '#/definitions/DeviceInfo' } },
        },
        description: 'ProfileMetadata\nProfile metadata (deeply nested)',
        required: ['last_login', 'login_count'],
    },
    DeviceInfo: {
        type: 'object',
        properties: { device_id: { type: 'string' }, device_type: { $ref: '#/definitions/DeviceType' }, last_active: { type: 'integer' } },
        description: 'DeviceInfo\nDevice info',
        required: ['device_id', 'device_type', 'last_active'],
    },
    DeviceType: {
        type: 'string',
        enum: ['DEVICE_TYPE_UNSPECIFIED', 'DEVICE_TYPE_MOBILE', 'DEVICE_TYPE_DESKTOP', 'DEVICE_TYPE_TABLET'],
        description: 'DeviceType\nDevice type enum',
    },
    UserRole: {
        type: 'object',
        properties: { name: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } } },
        description: 'UserRole\nUser role',
        required: ['name'],
    },
    Address: {
        type: 'object',
        properties: {
            type: { $ref: '#/definitions/AddressType' },
            street: { type: 'string' },
            city: { type: 'string' },
            postal_code: { type: 'string' },
            country: { type: 'string' },
        },
        description: 'Address\nAddress',
        required: ['type', 'street', 'city', 'postal_code', 'country'],
    },
    AddressType: {
        type: 'string',
        enum: ['ADDRESS_TYPE_UNSPECIFIED', 'ADDRESS_TYPE_HOME', 'ADDRESS_TYPE_WORK', 'ADDRESS_TYPE_BILLING'],
        description: 'AddressType\nAddress type enum',
    },
}

describe('SchemaReflection', () => {
    const testProtoDir = path.resolve(__dirname, '../proto')
    const testProtoFile = 'schema-reflection-test.proto'
    const includeDirs = [testProtoDir, path.join(resolvePackageDir('@diia-inhouse/types'), 'dist/proto'), resolvePackageDir('protobufjs')]

    describe('JsonSchemaGenerator', () => {
        let generator: JsonSchemaGenerator

        beforeAll(async () => {
            const metadata = await new ProtoMetadataExtractor().extract([testProtoFile], includeDirs)

            generator = new JsonSchemaGenerator(metadata.root, metadata.fieldComments, metadata.messageComments)
        })

        it.each([
            { message: 'GetUserRequest', expected: getUserRequestSchema },
            {
                message: 'InternalProcessRequest',
                expected: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', description: 'Process type' },
                        data: { type: 'string', format: 'byte', description: 'Process data as bytes' },
                        params: { type: 'array', items: { type: 'number', description: 'Numeric parameters' } },
                    },
                    description: 'Internal process request',
                    required: ['type', 'data'],
                },
            },
            {
                message: 'TreeNode',
                expected: {
                    type: 'object',
                    properties: treeNodeProperties,
                    description: 'Self-referencing message (circular)',
                    required: ['id', 'value'],
                    definitions: {
                        TreeNode: {
                            type: 'object',
                            properties: treeNodeProperties,
                            description: 'TreeNode\nSelf-referencing message (circular)',
                            required: ['id', 'value'],
                        },
                    },
                },
            },
            {
                message: 'Category',
                expected: {
                    type: 'object',
                    properties: categoryProperties,
                    description: 'Circular reference - Category',
                    required: ['id', 'name'],
                    definitions: {
                        Product: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                name: { type: 'string' },
                                price: { type: 'number' },
                                category: { $ref: '#/definitions/Category' },
                            },
                            description: 'Product\nCircular reference - Product',
                            required: ['id', 'name', 'price', 'category'],
                        },
                        Category: {
                            type: 'object',
                            properties: categoryProperties,
                            description: 'Category\nCircular reference - Category',
                            required: ['id', 'name'],
                        },
                    },
                },
            },
            {
                message: 'NotificationRequest',
                expected: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        user_id: { type: 'string', description: 'Recipient user ID' },
                        group_id: { type: 'string' },
                        broadcast: { type: 'boolean' },
                        text: { type: 'string' },
                        html: { type: 'string' },
                        template: { $ref: '#/definitions/TemplateRef' },
                    },
                    description: 'Oneof test message',
                    required: ['id'],
                    definitions: {
                        TemplateRef: {
                            type: 'object',
                            properties: {
                                template_id: { type: 'string' },
                                variables: { type: 'object', additionalProperties: { type: 'string' } },
                            },
                            description: 'TemplateRef\nTemplate reference',
                            required: ['template_id', 'variables'],
                        },
                    },
                },
            },
            {
                message: 'User',
                expected: {
                    type: 'object',
                    properties: userProperties,
                    description: 'User entity\n@see https://docs.example.com/user',
                    required: ['id', 'email', 'name', 'status', 'created_at', 'metadata', 'tag_counts'],
                    definitions: userDefinitions,
                },
            },
        ])('should generate the schema of $message', ({ message, expected }) => {
            const schema = generator.generateSchema(`ua.gov.diia.test.schema.${message}`)

            expect(withoutProtoSource(schema)).toEqual(expected)
        })

        it.each([
            {
                message: 'GetUserRequest',
                protoSource:
                    '// Request to get user by ID\nmessage GetUserRequest {\n  string id = 1; // User ID in UUID format\n  optional bool include_profile = 2; // Include profile\n}',
            },
            {
                message: 'NotificationRequest',
                protoSource:
                    '// Oneof test message\nmessage NotificationRequest {\n  oneof target {\n    string user_id = 2; // Recipient user ID\n    string group_id = 3;\n    bool broadcast = 4;\n  }\n  oneof content {\n    string text = 5;\n    string html = 6;\n    TemplateRef template = 7;\n  }\n  string id = 1;\n}',
            },
        ])('should keep the source of $message with its comments', ({ message, protoSource }) => {
            expect(generator.generateSchema(`ua.gov.diia.test.schema.${message}`).protoSource).toBe(protoSource)
        })

        it('should return an empty object schema for an unknown type', () => {
            expect(generator.generateSchema('NonExistentType')).toEqual({ type: 'object', properties: {} })
        })
    })

    describe('SchemaReflectionInitializer', () => {
        let registry: SchemaRegistry

        beforeAll(async () => {
            const pkgDefs = await load([testProtoFile], {
                keepCase: true,
                longs: String,
                enums: String,
                defaults: true,
                oneofs: true,
                includeDirs,
            })

            registry = new SchemaRegistry()
            await SchemaReflectionInitializer.initialize([testProtoFile], includeDirs, pkgDefs, registry)
        })

        it('should register every method of every service with its types, description and deprecation', () => {
            const unary = { deprecated: false, requestStream: false, responseStream: false }

            expect(registry.getAll().map(({ requestSchema, responseSchema, ...method }) => method)).toEqual([
                {
                    grpcMethod: '/ua.gov.diia.test.schema.SchemaTestService/GetUser',
                    requestTypeName: 'GetUserRequest',
                    responseTypeName: 'GetUserResponse',
                    description: 'Get user by ID',
                    ...unary,
                },
                {
                    grpcMethod: '/ua.gov.diia.test.schema.SchemaTestService/CreateUser',
                    requestTypeName: 'CreateUserRequest',
                    responseTypeName: 'CreateUserResponse',
                    description: 'Create a new user',
                    ...unary,
                },
                {
                    grpcMethod: '/ua.gov.diia.test.schema.SchemaTestService/UpdateUser',
                    requestTypeName: 'UpdateUserRequest',
                    responseTypeName: 'UpdateUserResponse',
                    description: 'Update user data',
                    ...unary,
                },
                {
                    grpcMethod: '/ua.gov.diia.test.schema.SchemaTestService/DeleteUser',
                    requestTypeName: 'DeleteUserRequest',
                    responseTypeName: 'DeleteUserResponse',
                    description: 'Delete a user',
                    ...unary,
                },
                {
                    grpcMethod: '/ua.gov.diia.test.schema.SchemaTestService/InternalProcess',
                    requestTypeName: 'InternalProcessRequest',
                    responseTypeName: 'InternalProcessResponse',
                    description:
                        'Internal method without HTTP mapping\n\n@deprecated use InternalProcessV2 instead.\nThis method will be removed in the next major version.',
                    ...unary,
                    deprecated: true,
                },
                {
                    grpcMethod: '/ua.gov.diia.test.schema.AdminService/ListUsers',
                    requestTypeName: 'ListUsersRequest',
                    responseTypeName: 'ListUsersResponse',
                    description: 'List all users',
                    ...unary,
                },
                {
                    grpcMethod: '/ua.gov.diia.test.schema.AdminService/BanUser',
                    requestTypeName: 'BanUserRequest',
                    responseTypeName: 'BanUserResponse',
                    description: 'Ban a user',
                    ...unary,
                    deprecated: true,
                },
            ])
        })

        it('should register the request and response schemas of a method', () => {
            const [getUser] = registry
                .getAll()
                .filter(({ grpcMethod }) => grpcMethod === '/ua.gov.diia.test.schema.SchemaTestService/GetUser')

            expect(withoutProtoSource(getUser.requestSchema)).toEqual(getUserRequestSchema)
            expect(withoutProtoSource(getUser.responseSchema)).toEqual({
                type: 'object',
                properties: {
                    user: { $ref: '#/definitions/User', description: 'The user' },
                    timestamp: { type: 'integer', description: 'Timestamp' },
                },
                description: 'Response with user data',
                required: ['user', 'timestamp'],
                definitions: {
                    ...userDefinitions,
                    User: {
                        type: 'object',
                        properties: userProperties,
                        description: 'User\nUser entity\n@see https://docs.example.com/user',
                        required: ['id', 'email', 'name', 'status', 'created_at', 'metadata', 'tag_counts'],
                    },
                },
            })
        })
    })
})
