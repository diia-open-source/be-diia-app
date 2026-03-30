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

describe('SchemaReflection', () => {
    const testProtoDir = path.resolve(__dirname, '../proto')
    const testProtoFile = 'schema-reflection-test.proto'
    const includeDirs = [testProtoDir, path.join(resolvePackageDir('@diia-inhouse/types'), 'dist/proto'), resolvePackageDir('protobufjs')]

    describe('ProtoMetadataExtractor', () => {
        let extractor: ProtoMetadataExtractor

        beforeAll(() => {
            extractor = new ProtoMetadataExtractor()
        })

        describe('method extraction', () => {
            it('extracts all 7 methods from both services', async () => {
                const metadata = await extractor.extract([testProtoFile], includeDirs)

                expect(metadata.methods).toHaveLength(7)

                const methodNames = metadata.methods.map((m) => m.methodName)

                expect(methodNames).toContain('GetUser')
                expect(methodNames).toContain('CreateUser')
                expect(methodNames).toContain('UpdateUser')
                expect(methodNames).toContain('DeleteUser')
                expect(methodNames).toContain('InternalProcess')
                expect(methodNames).toContain('ListUsers')
                expect(methodNames).toContain('BanUser')
            })

            it('builds full gRPC method paths with package and service name', async () => {
                const metadata = await extractor.extract([testProtoFile], includeDirs)

                const getUserMethod = metadata.methods.find((m) => m.methodName === 'GetUser')
                const listUsersMethod = metadata.methods.find((m) => m.methodName === 'ListUsers')

                expect(getUserMethod?.fullPath).toBe('/ua.gov.diia.test.schema.SchemaTestService/GetUser')
                expect(listUsersMethod?.fullPath).toBe('/ua.gov.diia.test.schema.AdminService/ListUsers')
            })

            it('extracts method descriptions from proto comments', async () => {
                const metadata = await extractor.extract([testProtoFile], includeDirs)

                const getUserMethod = metadata.methods.find((m) => m.methodName === 'GetUser')

                expect(getUserMethod?.description).toContain('Get user by ID')
            })

            it('populates methodDescriptions map keyed by full gRPC path', async () => {
                const metadata = await extractor.extract([testProtoFile], includeDirs)

                expect(metadata.methodDescriptions.size).toBeGreaterThan(0)
                expect(metadata.methodDescriptions.get('/ua.gov.diia.test.schema.SchemaTestService/GetUser')).toContain('Get user by ID')
            })
        })

        describe('deprecation extraction', () => {
            it('detects deprecated methods from @deprecated comment', async () => {
                const metadata = await extractor.extract([testProtoFile], includeDirs)

                expect(metadata.methodDeprecations.get('/ua.gov.diia.test.schema.SchemaTestService/InternalProcess')).toBe(true)
            })

            it('does not mark non-deprecated methods', async () => {
                const metadata = await extractor.extract([testProtoFile], includeDirs)

                expect(metadata.methodDeprecations.has('/ua.gov.diia.test.schema.SchemaTestService/GetUser')).toBe(false)
            })

            it('keeps full comment as description including @deprecated tag', async () => {
                const metadata = await extractor.extract([testProtoFile], includeDirs)

                const description = metadata.methodDescriptions.get('/ua.gov.diia.test.schema.SchemaTestService/InternalProcess')

                expect(description).toContain('Internal method without HTTP mapping')
                expect(description).toContain('@deprecated')
                expect(description).toContain('use InternalProcessV2 instead')
                expect(description).toContain('This method will be removed in the next major version')
            })
        })

        describe('comment extraction', () => {
            it('extracts field comments from message definitions', async () => {
                const metadata = await extractor.extract([testProtoFile], includeDirs)

                expect(metadata.fieldComments.get('GetUserRequest.id')).toBe('User ID in UUID format')
                expect(metadata.fieldComments.get('User.email')).toBe("User's email address")
                expect(metadata.fieldComments.get('User.created_at')).toBe('Account creation date in DD.MM.YYYY format')
            })

            it('extracts message comments including documentation links', async () => {
                const metadata = await extractor.extract([testProtoFile], includeDirs)

                expect(metadata.messageComments.get('User')).toContain('@see https://docs.example.com/user')
                expect(metadata.messageComments.get('GetUserRequest')).toBe('Request to get user by ID')
            })

            it('extracts enum comments', async () => {
                const metadata = await extractor.extract([testProtoFile], includeDirs)

                expect(metadata.messageComments.get('UserStatus')).toContain('User status enumeration')
            })
        })

        it('provides protobuf root for schema generation', async () => {
            const metadata = await extractor.extract([testProtoFile], includeDirs)

            expect(metadata.root).toBeDefined()
            expect(() => metadata.root.lookupType('ua.gov.diia.test.schema.User')).not.toThrow()
        })
    })

    describe('JsonSchemaGenerator', () => {
        let generator: JsonSchemaGenerator

        beforeAll(async () => {
            const extractor = new ProtoMetadataExtractor()
            const metadata = await extractor.extract([testProtoFile], includeDirs)

            generator = new JsonSchemaGenerator(metadata.root, metadata.fieldComments, metadata.messageComments)
        })

        describe('basic schema generation', () => {
            it('generates object schema with properties for simple message', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.GetUserRequest')

                expect(schema.type).toBe('object')
                expect(schema.properties).toHaveProperty('id')
                expect(schema.properties).toHaveProperty('include_profile')
            })

            it('marks non-optional non-array fields as required', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.GetUserRequest')

                expect(schema.required).toContain('id')
                expect(schema.required).not.toContain('include_profile')
            })

            it('returns empty schema for unknown type', () => {
                const schema = generator.generateSchema('NonExistentType')

                expect(schema.type).toBe('object')
                expect(schema.properties).toEqual({})
            })
        })

        describe('primitive types', () => {
            it('maps protobuf bytes to JSON Schema string with byte format', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.InternalProcessRequest')

                const properties = schema.properties as Record<string, { type: string; format?: string }>

                expect(properties.data).toEqual({ type: 'string', format: 'byte', description: 'Process data as bytes' })
            })

            it('maps protobuf double to JSON Schema number', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.Product')

                const properties = schema.properties as Record<string, { type: string }>

                expect(properties.price.type).toBe('number')
            })

            it('maps protobuf int32 to JSON Schema integer', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.ListUsersResponse')

                const properties = schema.properties as Record<string, { type: string }>

                expect(properties.total.type).toBe('integer')
            })
        })

        describe('repeated fields', () => {
            it('generates array schema for repeated primitive fields', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.InternalProcessRequest')

                const properties = schema.properties as Record<string, { type: string; items?: object }>

                expect(properties.params.type).toBe('array')
                expect(properties.params.items).toEqual({ type: 'number', description: 'Numeric parameters' })
            })

            it('generates array schema with $ref for repeated message fields', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.User')

                const properties = schema.properties as Record<string, { type?: string; items?: { $ref?: string } }>

                expect(properties.roles.type).toBe('array')
                expect(properties.roles.items?.$ref).toBe('#/definitions/UserRole')
            })
        })

        describe('nested types', () => {
            it('includes nested message types in definitions', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.GetUserResponse')

                expect(schema.properties).toHaveProperty('user')
                expect(schema.definitions).toHaveProperty('User')
            })

            it('uses $ref for nested message type fields', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.User')

                const properties = schema.properties as Record<string, { $ref?: string }>

                expect(properties.profile.$ref).toBe('#/definitions/UserProfile')
                expect(properties.status.$ref).toBe('#/definitions/UserStatus')
            })

            it('includes deeply nested types in definitions', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.User')

                // User -> UserProfile -> ProfileMetadata -> DeviceInfo -> DeviceType
                expect(schema.definitions).toHaveProperty('UserProfile')
                expect(schema.definitions).toHaveProperty('ProfileMetadata')
                expect(schema.definitions).toHaveProperty('DeviceInfo')
                expect(schema.definitions).toHaveProperty('DeviceType')
            })
        })

        describe('enum types', () => {
            it('generates string type with enum values', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.User')

                expect(schema.definitions).toHaveProperty('UserStatus')
                const userStatusDef = schema.definitions!['UserStatus'] as { type: string; enum: string[] }

                expect(userStatusDef.type).toBe('string')
                expect(userStatusDef.enum).toContain('USER_STATUS_ACTIVE')
                expect(userStatusDef.enum).toContain('USER_STATUS_INACTIVE')
            })
        })

        describe('oneof fields', () => {
            it('includes all oneof variant fields as properties', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.NotificationRequest')

                const properties = schema.properties as Record<string, object>

                expect(properties).toHaveProperty('user_id')
                expect(properties).toHaveProperty('group_id')
                expect(properties).toHaveProperty('broadcast')
                expect(properties).toHaveProperty('text')
                expect(properties).toHaveProperty('html')
                expect(properties).toHaveProperty('template')
            })
        })

        describe('circular references', () => {
            it('handles self-referencing message (TreeNode)', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.TreeNode')

                expect(schema.definitions).toHaveProperty('TreeNode')

                const properties = schema.properties as Record<string, { $ref?: string; items?: { $ref?: string } }>

                expect(properties.parent.$ref).toBe('#/definitions/TreeNode')
                expect(properties.children.items?.$ref).toBe('#/definitions/TreeNode')
            })

            it('handles mutually referencing messages (Category <-> Product)', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.Category')

                expect(schema.definitions).toHaveProperty('Category')
                expect(schema.definitions).toHaveProperty('Product')
            })
        })

        describe('descriptions', () => {
            it('includes field descriptions from proto comments', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.User')

                const properties = schema.properties as Record<string, { description?: string }>

                expect(properties.email.description).toBe("User's email address")
                expect(properties.created_at.description).toBe('Account creation date in DD.MM.YYYY format')
            })

            it('includes message descriptions in definitions', () => {
                const schema = generator.generateSchema('ua.gov.diia.test.schema.GetUserResponse')

                const userDef = schema.definitions!['User'] as { description?: string }

                expect(userDef.description).toContain('User')
                expect(userDef.description).toContain('@see https://docs.example.com/user')
            })
        })
    })

    describe('SchemaReflectionInitializer', () => {
        const loadOptions = {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
            includeDirs,
        }

        it('initializes registry with all methods from proto files', async () => {
            const pkgDefs = await load([testProtoFile], loadOptions)
            const registry = new SchemaRegistry()

            await SchemaReflectionInitializer.initialize([testProtoFile], includeDirs, pkgDefs, registry)

            expect(registry.getAll().length).toBe(7)
        })

        it('registers methods with correct gRPC paths', async () => {
            const pkgDefs = await load([testProtoFile], loadOptions)
            const registry = new SchemaRegistry()

            await SchemaReflectionInitializer.initialize([testProtoFile], includeDirs, pkgDefs, registry)

            const allMethods = registry.getAll()
            const getUserMethod = allMethods.find((m) => m.grpcMethod === '/ua.gov.diia.test.schema.SchemaTestService/GetUser')
            const listUsersMethod = allMethods.find((m) => m.grpcMethod === '/ua.gov.diia.test.schema.AdminService/ListUsers')

            expect(getUserMethod).toBeDefined()
            expect(listUsersMethod).toBeDefined()
        })

        it('includes method descriptions from proto comments', async () => {
            const pkgDefs = await load([testProtoFile], loadOptions)
            const registry = new SchemaRegistry()

            await SchemaReflectionInitializer.initialize([testProtoFile], includeDirs, pkgDefs, registry)

            const getUserMethod = registry.getAll().find((m) => m.grpcMethod === '/ua.gov.diia.test.schema.SchemaTestService/GetUser')

            expect(getUserMethod?.description).toContain('Get user by ID')
        })

        it('generates complete request and response schemas', async () => {
            const pkgDefs = await load([testProtoFile], loadOptions)
            const registry = new SchemaRegistry()

            await SchemaReflectionInitializer.initialize([testProtoFile], includeDirs, pkgDefs, registry)

            const getUserMethod = registry.getAll().find((m) => m.grpcMethod === '/ua.gov.diia.test.schema.SchemaTestService/GetUser')

            const requestSchema = getUserMethod?.requestSchema as { type: string; properties: object; required?: string[] }

            expect(requestSchema.type).toBe('object')
            expect(requestSchema.properties).toHaveProperty('id')
            expect(requestSchema.required).toContain('id')

            const responseSchema = getUserMethod?.responseSchema as { type: string; properties: object; definitions?: object }

            expect(responseSchema.type).toBe('object')
            expect(responseSchema.properties).toHaveProperty('user')
            expect(responseSchema.definitions).toHaveProperty('User')
        })
    })

    describe('SchemaRegistry', () => {
        const loadOptions = {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
            includeDirs,
        }

        it('allows setting action info after initialization', async () => {
            const pkgDefs = await load([testProtoFile], loadOptions)
            const registry = new SchemaRegistry()

            await SchemaReflectionInitializer.initialize([testProtoFile], includeDirs, pkgDefs, registry)

            registry.setActionInfo('/ua.gov.diia.test.schema.SchemaTestService/GetUser', 'getUser', 'User,ServiceUser')

            const method = registry.getAll().find((m) => m.grpcMethod === '/ua.gov.diia.test.schema.SchemaTestService/GetUser')

            expect(method?.actionName).toBe('getUser')
            expect(method?.sessionType).toBe('User,ServiceUser')
        })
    })
})
