import { Metadata } from '@grpc/grpc-js'

import { HttpMapping, ServiceSchemaDto } from './types.js'

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
    deprecated?: boolean
    requestStream?: boolean
    responseStream?: boolean
}

export interface DiscoveredSchema {
    serviceName: string
    version: string
    actions: DiscoveredAction[]
    definitions: Record<string, object>
}

export interface GrpcSchemaClient {
    getSchemas: (
        request: Record<string, never>,
        metadataOrCallback: Metadata | ((error: Error | null, response: ServiceSchemaDto) => void),
        callback?: (error: Error | null, response: ServiceSchemaDto) => void,
    ) => void
}

export interface SchemaReflectionClientWithClose extends GrpcSchemaClient {
    close(): void
}
