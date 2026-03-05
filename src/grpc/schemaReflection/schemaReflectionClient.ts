import { Metadata, ServiceClientConstructor, credentials, loadPackageDefinition } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'

import { schemaReflectionProtoPath } from './grpcSchemaService'
import { HttpMapping, PROTO_LOADER_OPTIONS, ServiceSchemaDto } from './types'

export interface DiscoveredAction {
    name: string
    grpcMethod: string
    sessionType: string
    requestSchema: object
    responseSchema: object
    requestTypeName?: string
    responseTypeName?: string
    httpMapping?: HttpMapping
    description?: string
    requestStream?: boolean
    responseStream?: boolean
}

export interface DiscoveredSchema {
    serviceName: string
    version: string
    actions: DiscoveredAction[]
    definitions: Record<string, object>
}

interface GrpcSchemaClient {
    getSchemas: (
        request: Record<string, never>,
        metadataOrCallback: Metadata | ((error: Error | null, response: ServiceSchemaDto) => void),
        callback?: (error: Error | null, response: ServiceSchemaDto) => void,
    ) => void
}

interface SchemaReflectionClientWithClose extends GrpcSchemaClient {
    close(): void
}

export class SchemaReflectionClient {
    private readonly serviceDefinition: ServiceClientConstructor | undefined

    private readonly clients: Map<string, SchemaReflectionClientWithClose> = new Map()

    constructor() {
        this.serviceDefinition = this.loadServiceDefinition()
    }

    async fetchSchema(address: string, metadata?: Metadata): Promise<DiscoveredSchema | null> {
        const client = this.getOrCreateClient(address)
        if (!client) {
            return null
        }

        const response = await this.callGetSchemas(client, metadata)

        return this.transformResponse(response)
    }

    close(): void {
        for (const client of this.clients.values()) {
            client.close()
        }

        this.clients.clear()
    }

    private loadServiceDefinition(): ServiceClientConstructor | undefined {
        try {
            const packageDefinition = loadSync(schemaReflectionProtoPath, PROTO_LOADER_OPTIONS)
            const protoDescriptor = loadPackageDefinition(packageDefinition)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const schemaService = (protoDescriptor.diia as any)?.schema?.v1?.SchemaReflection

            return schemaService as ServiceClientConstructor | undefined
        } catch {
            return undefined
        }
    }

    private getOrCreateClient(address: string): SchemaReflectionClientWithClose | undefined {
        const existing = this.clients.get(address)
        if (existing) {
            return existing
        }

        if (!this.serviceDefinition) {
            return undefined
        }

        const client = new this.serviceDefinition(address, credentials.createInsecure()) as unknown as SchemaReflectionClientWithClose

        this.clients.set(address, client)

        return client
    }

    private callGetSchemas(client: GrpcSchemaClient, metadata?: Metadata): Promise<ServiceSchemaDto> {
        return new Promise((resolve, reject) => {
            if (metadata) {
                client.getSchemas({}, metadata, (error, response) => {
                    if (error) {
                        reject(error)
                    } else {
                        resolve(response)
                    }
                })
            } else {
                client.getSchemas({}, (error, response) => {
                    if (error) {
                        reject(error)
                    } else {
                        resolve(response)
                    }
                })
            }
        })
    }

    private transformResponse(response: ServiceSchemaDto): DiscoveredSchema {
        const definitions = this.parseJsonSafe(response.definitionsJson || '{}') as Record<string, object>

        return {
            serviceName: response.serviceName,
            version: response.version,
            actions: response.actions.map((action) => ({
                name: action.name,
                grpcMethod: action.grpcMethod,
                sessionType: action.sessionType,
                requestSchema: this.parseJsonSafe(action.requestSchemaJson),
                responseSchema: this.parseJsonSafe(action.responseSchemaJson),
                requestTypeName: action.requestTypeName,
                responseTypeName: action.responseTypeName,
                httpMapping: action.httpMapping,
                description: action.description,
                requestStream: action.requestStream,
                responseStream: action.responseStream,
            })),
            definitions,
        }
    }

    private parseJsonSafe(json: string): object {
        if (!json) {
            return {}
        }

        try {
            return JSON.parse(json)
        } catch {
            return {}
        }
    }
}
