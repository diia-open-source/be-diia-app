import type { Options } from '@grpc/proto-loader'
import protobuf from 'protobufjs'

export const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const

export const PROTO_LOADER_OPTIONS = {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: ['/usr/local/include', '/usr/include'],
} satisfies Options

export interface HttpMapping {
    method: string
    path: string
}

export function extractHttpMapping(options: Record<string, unknown> | undefined): HttpMapping | undefined {
    const httpRule = options?.['(google.api.http)'] as Record<string, string> | undefined
    if (!httpRule) {
        return undefined
    }

    for (const method of HTTP_METHODS) {
        if (httpRule[method]) {
            return { method: method.toUpperCase(), path: httpRule[method] }
        }
    }

    return undefined
}

export interface GrpcMethodDefinition {
    path: string
    requestType?: { type?: { name: string } }
    responseType?: { type?: { name: string } }
    requestStream?: boolean
    responseStream?: boolean
    options?: Record<string, unknown>
}

export interface ProtoMetadata {
    root: protobuf.Root
    methods: MethodMetadata[]
    methodDescriptions: Map<string, string>
    fieldComments: Map<string, string>
    messageComments: Map<string, string>
}

export interface MethodMetadata {
    serviceName: string
    methodName: string
    fullPath: string
    httpMethod?: string
    httpPath?: string
    description?: string
}

export interface JsonSchemaRef {
    $ref: string
    description?: string
}

export interface JsonSchemaArray {
    type: 'array'
    items: JsonSchemaProperty
    description?: string
}

export interface JsonSchemaPrimitive {
    type: 'string' | 'number' | 'integer' | 'boolean'
    format?: string
    enum?: string[]
    description?: string
    protoSource?: string
}

export interface JsonSchemaObject {
    type: 'object'
    properties: Record<string, JsonSchemaProperty>
    required?: string[]
    description?: string
    protoSource?: string
}

export interface JsonSchemaMap {
    type: 'object'
    additionalProperties: JsonSchemaProperty
    description?: string
}

export type JsonSchemaProperty = JsonSchemaRef | JsonSchemaArray | JsonSchemaPrimitive | JsonSchemaObject | JsonSchemaMap

export interface JsonSchema extends JsonSchemaObject {
    definitions?: Record<string, JsonSchemaProperty>
}

export interface RegisteredMethod {
    grpcMethod: string
    requestSchema: JsonSchema
    responseSchema: JsonSchema
    requestTypeName?: string
    responseTypeName?: string
    httpMapping?: HttpMapping
    description?: string
    sessionType?: string
    actionName?: string
    requestStream?: boolean
    responseStream?: boolean
}

export interface ActionSchemaDto {
    name: string
    grpcMethod: string
    sessionType: string
    requestSchemaJson: string
    responseSchemaJson: string
    requestTypeName?: string
    responseTypeName?: string
    httpMapping?: HttpMapping
    description?: string
    requestStream?: boolean
    responseStream?: boolean
}

export interface ServiceSchemaDto {
    serviceName: string
    version: string
    actions: ActionSchemaDto[]
    definitionsJson?: string
}
