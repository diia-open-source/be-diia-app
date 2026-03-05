import path from 'node:path'

import { ChannelCredentials, ServiceClientConstructor, loadPackageDefinition } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'

import { getApp } from '../getApp'

interface ActionSchema {
    name: string
    grpcMethod: string
    sessionType: string
    requestSchemaJson: string
    responseSchemaJson: string
    httpMapping?: { method: string; path: string }
    description?: string
}

interface ServiceSchemaResponse {
    serviceName: string
    version: string
    actions: ActionSchema[]
    definitionsJson: string
}

interface SchemaReflectionClient {
    getSchemas: (request: object, callback: (error: Error | null, response: ServiceSchemaResponse) => void) => void
}

describe('SchemaReflection gRPC Endpoint', () => {
    let app: Awaited<ReturnType<typeof getApp>>
    let serverPort: number
    let schemaClient: SchemaReflectionClient

    beforeAll(async () => {
        app = await getApp()
        await app.container.resolve('grpcService').onHealthCheck()

        // Get the actual server port from container
        serverPort = app.container.resolve('grpcServerPort') as number

        // Load the SchemaReflection proto and create a client
        const protoPath = path.resolve(__dirname, '../../../proto/schema-reflection.proto')
        const packageDefinition = loadSync(protoPath, {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
        })

        const protoDescriptor = loadPackageDefinition(packageDefinition)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const SchemaReflection = (protoDescriptor.diia as any)?.schema?.v1?.SchemaReflection as ServiceClientConstructor

        if (!SchemaReflection) {
            throw new Error('Failed to load SchemaReflection service from proto')
        }

        schemaClient = new SchemaReflection(
            `localhost:${serverPort}`,
            ChannelCredentials.createInsecure(),
        ) as unknown as SchemaReflectionClient
    })

    afterAll(async () => {
        await app.stop()
    })

    it('returns service schema response with service name and version', async () => {
        const response = await new Promise<ServiceSchemaResponse>((resolve, reject) => {
            schemaClient.getSchemas({}, (error, result) => {
                if (error) {
                    reject(error)
                } else {
                    resolve(result)
                }
            })
        })

        expect(response.serviceName).toBeDefined()
        expect(response.version).toBeDefined()
    })

    it('returns actions array with registered gRPC methods', async () => {
        const response = await new Promise<ServiceSchemaResponse>((resolve, reject) => {
            schemaClient.getSchemas({}, (error, result) => {
                if (error) {
                    reject(error)
                } else {
                    resolve(result)
                }
            })
        })

        expect(Array.isArray(response.actions)).toBe(true)
    })

    it('returns definitions_json as valid JSON string', async () => {
        const response = await new Promise<ServiceSchemaResponse>((resolve, reject) => {
            schemaClient.getSchemas({}, (error, result) => {
                if (error) {
                    reject(error)
                } else {
                    resolve(result)
                }
            })
        })

        expect(() => JSON.parse(response.definitionsJson)).not.toThrow()
    })

    it('includes request and response schemas as valid JSON for each action', async () => {
        const response = await new Promise<ServiceSchemaResponse>((resolve, reject) => {
            schemaClient.getSchemas({}, (error, result) => {
                if (error) {
                    reject(error)
                } else {
                    resolve(result)
                }
            })
        })

        for (const action of response.actions) {
            expect(action.grpcMethod).toBeDefined()
            expect(() => JSON.parse(action.requestSchemaJson)).not.toThrow()
            expect(() => JSON.parse(action.responseSchemaJson)).not.toThrow()
        }
    })
})
