import path from 'node:path'

import { ChannelCredentials, Client, Metadata, ServiceError, credentials, loadPackageDefinition } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import protobuf from 'protobufjs'
import descriptorExt from 'protobufjs/ext/descriptor'

import { Logger } from '@diia-inhouse/types'

import { PROTO_LOADER_OPTIONS } from './schemaReflection/types'
import { registerWrappers } from './wrappers'

const DEFAULT_REFLECTION_TIMEOUT_MS = 15_000
const DEFAULT_CALL_TIMEOUT_MS = 30_000

export interface DynamicGrpcClientOptions {
    credentials?: ChannelCredentials
    reflectionTimeoutMs?: number
    callTimeoutMs?: number
}

const GRPC_CHANNEL_OPTIONS = {
    'grpc.keepalive_time_ms': 15_000,
    'grpc.keepalive_timeout_ms': 10_000,
    'grpc.keepalive_permit_without_calls': 1,
} as const

const PROTOBUF_TO_OBJECT_OPTIONS = {
    defaults: true,
    longs: String,
    enums: String,
    bytes: String,
} as const

// The protobufjs/ext/descriptor extension adds `fromDescriptor` method to Root.
// This is not in the TypeScript types, so we need to cast it.
// See: https://github.com/protobufjs/protobuf.js/blob/master/ext/descriptor/index.js

const { FileDescriptorProto } = descriptorExt

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RootWithDescriptor = protobuf.Root as any as {
    fromDescriptor(descriptor: { file: unknown[] }): protobuf.Root
}

export interface DynamicCallParams {
    address: string
    /** gRPC method path in format: /package.Service/Method */
    method: string
    body: object
    metadata?: Metadata
}

interface ReflectionClient extends Client {
    ServerReflectionInfo(metadata?: Metadata): ReturnType<Client['makeBidiStreamRequest']>
}

interface FileDescriptorResponse {
    file_descriptor_response?: {
        file_descriptor_proto: Buffer[]
    }
    error_response?: {
        error_code: number
        error_message: string
    }
}

/**
 * A gRPC client that discovers service schemas at runtime via server reflection.
 *
 * This allows making gRPC calls without compile-time proto files. The client:
 * 1. Fetches service schema via gRPC Server Reflection API
 * 2. Parses file descriptors into protobuf.js types
 * 3. Encodes requests and decodes responses dynamically
 *
 * Caches are maintained for:
 * - Parsed proto schemas (per address:service)
 * - gRPC clients (per address)
 * - Reflection clients (per address)
 */
export class DynamicGrpcClient {
    private readonly schemaCache = new Map<string, protobuf.Root>()

    private readonly clientCache = new Map<string, Client>()

    private readonly reflectionClientCache = new Map<string, ReflectionClient>()

    private readonly credentials: ChannelCredentials

    private readonly reflectionTimeoutMs: number

    private readonly callTimeoutMs: number

    constructor(
        private readonly logger: Logger,
        options?: DynamicGrpcClientOptions,
    ) {
        this.credentials = options?.credentials ?? credentials.createInsecure()
        this.reflectionTimeoutMs = options?.reflectionTimeoutMs ?? DEFAULT_REFLECTION_TIMEOUT_MS
        this.callTimeoutMs = options?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS

        // Register custom wrappers for types like google.protobuf.Timestamp
        registerWrappers(this.logger)
    }

    async call(params: DynamicCallParams): Promise<object> {
        const { address, method, body, metadata } = params
        const { serviceName, methodName } = this.parseMethodPath(method)

        const root = await this.getSchema(address, serviceName, metadata)
        const { RequestType, ResponseType } = this.getMethodTypes(root, serviceName, methodName)

        const requestBuffer = this.encodeRequest(RequestType, body)
        const responseBuffer = await this.executeCall(address, method, requestBuffer, metadata)

        return this.decodeResponse(ResponseType, responseBuffer)
    }

    close(): void {
        for (const client of this.clientCache.values()) {
            client.close()
        }

        for (const client of this.reflectionClientCache.values()) {
            client.close()
        }

        this.clientCache.clear()
        this.reflectionClientCache.clear()
        this.schemaCache.clear()
    }

    private parseMethodPath(method: string): { serviceName: string; methodName: string } {
        const match = method.match(/^\/(.+)\/([^/]+)$/)
        if (!match) {
            throw new Error(`Invalid method format: ${method}. Expected: /package.Service/Method`)
        }

        return { serviceName: match[1], methodName: match[2] }
    }

    private getMethodTypes(
        root: protobuf.Root,
        serviceName: string,
        methodName: string,
    ): { RequestType: protobuf.Type; ResponseType: protobuf.Type } {
        const service = root.lookupService(serviceName)
        const methodDef = service.methods[methodName]
        if (!methodDef) {
            throw new Error(`Method ${methodName} not found in service ${serviceName}`)
        }

        return {
            RequestType: root.lookupType(methodDef.requestType),
            ResponseType: root.lookupType(methodDef.responseType),
        }
    }

    private encodeRequest(RequestType: protobuf.Type, body: object): Uint8Array {
        const convertedBody = this.convertEnumValues(RequestType, body)

        const validationError = RequestType.verify(convertedBody)
        if (validationError) {
            throw new Error(`Request validation failed: ${validationError}`)
        }

        const message = RequestType.fromObject(convertedBody)

        return RequestType.encode(message).finish()
    }

    /**
     * Converts string enum values to their numeric equivalents.
     *
     * protobufjs verify() expects numeric enum values, but JSON input from UI
     * contains string enum names. This method recursively processes the body
     * and converts string enum values to numbers using the type's enum definitions.
     */
    private convertEnumValues(type: protobuf.Type, body: object): object {
        if (!body || typeof body !== 'object') {
            return body
        }

        const result: Record<string, unknown> = { ...body }

        for (const field of type.fieldsArray) {
            const value = result[field.name]
            if (value === undefined || value === null) {
                continue
            }

            // Coerce string query params to matching scalar types
            if (typeof value === 'string' && this.isBuiltinType(field.type)) {
                result[field.name] = this.coerceScalar(field.type, value)
                continue
            }

            let resolvedType = field.resolvedType
            if (!resolvedType && field.type && !this.isBuiltinType(field.type)) {
                try {
                    resolvedType = type.root.lookupTypeOrEnum(field.type)
                    field.resolve()
                } catch {
                    // Type not found, skip conversion
                }
            }

            if (resolvedType instanceof protobuf.Enum) {
                result[field.name] =
                    field.repeated && Array.isArray(value)
                        ? value.map((v) => this.convertSingleEnumValue(resolvedType as protobuf.Enum, v))
                        : this.convertSingleEnumValue(resolvedType, value)
            } else if (resolvedType instanceof protobuf.Type) {
                result[field.name] =
                    field.repeated && Array.isArray(value)
                        ? value.map((v) => this.convertEnumValues(resolvedType as protobuf.Type, v as object))
                        : this.convertEnumValues(resolvedType, value as object)
            }
        }

        return result
    }

    private convertSingleEnumValue(enumType: protobuf.Enum, value: unknown): number | unknown {
        if (typeof value === 'string') {
            const numericValue = enumType.values[value]
            if (numericValue !== undefined) {
                return numericValue
            }
        }

        return value
    }

    private decodeResponse(ResponseType: protobuf.Type, buffer: Buffer): object {
        const message = ResponseType.decode(buffer)

        return ResponseType.toObject(message, PROTOBUF_TO_OBJECT_OPTIONS)
    }

    private async getSchema(address: string, serviceName: string, metadata?: Metadata): Promise<protobuf.Root> {
        const cacheKey = `${address}:${serviceName}`
        const cached = this.schemaCache.get(cacheKey)
        if (cached) {
            return cached
        }

        const fileDescriptors = await this.fetchFileDescriptors(address, serviceName, metadata)
        const root = this.buildProtoRoot(fileDescriptors)

        await this.resolveAllTypes(root, address, metadata)

        this.schemaCache.set(cacheKey, root)

        return root
    }

    private async resolveAllTypes(root: protobuf.Root, address: string, metadata?: Metadata): Promise<void> {
        const maxIterations = 10
        const fetchedTypes = new Set<string>()

        for (let i = 0; i < maxIterations; i++) {
            const unresolvedTypes = this.findUnresolvedTypes(root)
            const typesToFetch = unresolvedTypes.filter((t) => !fetchedTypes.has(t))

            if (typesToFetch.length === 0) {
                break
            }

            for (const typeName of typesToFetch) {
                fetchedTypes.add(typeName)
                try {
                    const descriptors = await this.fetchFileDescriptors(address, typeName, metadata)

                    this.mergeDescriptorsIntoRoot(root, descriptors)
                } catch (err) {
                    this.logger.warn('Failed to fetch type descriptor, creating placeholder', { typeName, err })
                    this.createPlaceholderType(root, typeName)
                }
            }
        }
    }

    /**
     * Creates an empty placeholder type for types that can't be resolved via reflection.
     *
     * When a gRPC server doesn't expose all transitive dependencies via reflection,
     * we create placeholder types to allow protobuf.js to decode responses without errors.
     * Fields with placeholder types will be decoded as empty objects.
     */
    private createPlaceholderType(root: protobuf.Root, typeName: string): void {
        const parts = typeName.split('.')
        const name = parts.pop()
        if (!name) {
            return
        }

        let current: protobuf.NamespaceBase = root
        for (const part of parts) {
            let next = current.get(part)
            if (!next) {
                next = new protobuf.Namespace(part)
                current.add(next)
            }

            if (next instanceof protobuf.Namespace) {
                current = next
            } else {
                this.logger.warn('Cannot create placeholder: path conflict', { typeName, conflictAt: part })

                return
            }
        }

        if (!current.get(name)) {
            const placeholder = new protobuf.Type(name)

            current.add(placeholder)
        }
    }

    private findUnresolvedTypes(root: protobuf.Root): string[] {
        const unresolved: string[] = []
        const allTypeRefs = new Set<string>()

        const collectTypeRefs = (type: protobuf.Type): void => {
            for (const field of type.fieldsArray) {
                if (this.isBuiltinType(field.type)) {
                    continue
                }

                const fullTypeName = field.type.startsWith('.') ? field.type.slice(1) : field.type

                allTypeRefs.add(fullTypeName)
            }

            for (const nested of type.nestedArray) {
                if (nested instanceof protobuf.Type) {
                    collectTypeRefs(nested)
                }
            }
        }

        const checkNamespace = (ns: protobuf.NamespaceBase): void => {
            for (const nested of ns.nestedArray) {
                if (nested instanceof protobuf.Type) {
                    collectTypeRefs(nested)
                } else if (nested instanceof protobuf.Namespace) {
                    checkNamespace(nested)
                }
            }
        }

        checkNamespace(root)

        for (const typeName of allTypeRefs) {
            try {
                root.lookupTypeOrEnum(typeName)
            } catch {
                if (!unresolved.includes(typeName)) {
                    unresolved.push(typeName)
                }
            }
        }

        return unresolved
    }

    private coerceScalar(fieldType: string, value: string): unknown {
        if (fieldType === 'bool') {
            return value === 'true' || value === '1'
        }

        const numericTypes = [
            'double',
            'float',
            'int32',
            'int64',
            'uint32',
            'uint64',
            'sint32',
            'sint64',
            'fixed32',
            'fixed64',
            'sfixed32',
            'sfixed64',
        ]
        if (numericTypes.includes(fieldType)) {
            const num = Number(value)

            return Number.isNaN(num) ? value : num
        }

        return value
    }

    private isBuiltinType(typeName: string): boolean {
        const builtins = [
            'double',
            'float',
            'int32',
            'int64',
            'uint32',
            'uint64',
            'sint32',
            'sint64',
            'fixed32',
            'fixed64',
            'sfixed32',
            'sfixed64',
            'bool',
            'string',
            'bytes',
        ]

        return builtins.includes(typeName)
    }

    private mergeDescriptorsIntoRoot(root: protobuf.Root, fileDescriptors: Buffer[]): void {
        const decoded: unknown[] = []
        for (const buffer of fileDescriptors) {
            try {
                decoded.push(FileDescriptorProto.decode(buffer))
            } catch (err) {
                this.logger.warn('Failed to decode file descriptor', { err })
            }
        }

        if (decoded.length === 0) {
            return
        }

        // protobufjs 7.5+ calls resolveAll() inside fromDescriptor(), which throws
        // when transitive proto dependencies are missing from the descriptor set.
        // Make it tolerant so types are added even with unresolved references —
        // resolveAllTypes() handles missing types via reflection or placeholders.
        const originalResolveAll = protobuf.Root.prototype.resolveAll
        protobuf.Root.prototype.resolveAll = function tolerantResolveAll(this: protobuf.Root): protobuf.Root {
            try {
                return originalResolveAll.call(this) as protobuf.Root
            } catch {
                return this
            }
        }

        try {
            const parsed = RootWithDescriptor.fromDescriptor({ file: decoded })
            for (const nested of parsed.nestedArray) {
                this.mergeIntoNamespace(root, nested)
            }
        } catch (err) {
            this.logger.warn('Failed to parse file descriptors', { err })
        } finally {
            protobuf.Root.prototype.resolveAll = originalResolveAll
        }
    }

    private async fetchFileDescriptors(address: string, symbolName: string, metadata?: Metadata): Promise<Buffer[]> {
        const client = this.getOrCreateReflectionClient(address)

        return await new Promise((resolve, reject) => {
            const call = client.ServerReflectionInfo(metadata || new Metadata())
            const fileDescriptors: Buffer[] = []

            const timeout = setTimeout(() => {
                call.end()
                reject(new Error(`Reflection timeout after ${this.reflectionTimeoutMs}ms for symbol ${symbolName}`))
            }, this.reflectionTimeoutMs)

            call.on('data', (response: FileDescriptorResponse) => {
                if (response.error_response) {
                    clearTimeout(timeout)
                    call.end()
                    reject(new Error(`Reflection error: ${response.error_response.error_message}`))

                    return
                }

                if (response.file_descriptor_response?.file_descriptor_proto) {
                    fileDescriptors.push(...response.file_descriptor_response.file_descriptor_proto)
                    call.end()
                }
            })

            call.on('error', (err: Error) => {
                clearTimeout(timeout)
                this.logger.error('Reflection error', { err, address, symbolName })
                reject(err)
            })

            call.on('end', () => {
                clearTimeout(timeout)
                if (fileDescriptors.length === 0) {
                    reject(new Error(`No file descriptors received for symbol ${symbolName}`))
                } else {
                    resolve(fileDescriptors)
                }
            })

            call.write({ file_containing_symbol: symbolName })
        })
    }

    /**
     * Builds a unified protobuf.Root from multiple file descriptors.
     *
     * IMPORTANT: Each file descriptor is parsed separately and then merged into
     * a single Root. This is necessary because file descriptors from reflection
     * come from different proto files that may share package namespaces.
     * Simple concatenation would fail; we need to recursively merge namespaces.
     */
    private buildProtoRoot(fileDescriptors: Buffer[]): protobuf.Root {
        const root = new protobuf.Root()

        this.mergeDescriptorsIntoRoot(root, fileDescriptors)

        return root
    }

    /**
     * Recursively merges a proto namespace/type into the target namespace.
     *
     * WHY THIS IS NEEDED:
     * When multiple proto files contribute to the same package (e.g., ua.gov.diia.types),
     * we can't just add them directly - that would throw "duplicate name" errors.
     * Instead, we need to merge namespace contents recursively while preserving
     * all types, enums, and nested messages from all contributing files.
     */
    private mergeIntoNamespace(target: protobuf.NamespaceBase, source: protobuf.ReflectionObject): void {
        const existing = target.get(source.name)

        if (!existing) {
            target.add(source)

            return
        }

        if (existing instanceof protobuf.Namespace && source instanceof protobuf.Namespace) {
            for (const nested of source.nestedArray) {
                this.mergeIntoNamespace(existing, nested)
            }
        }
        // Type conflicts (namespace vs non-namespace) are silently skipped
    }

    private async executeCall(address: string, method: string, request: Uint8Array, metadata?: Metadata): Promise<Buffer> {
        const client = this.getOrCreateClient(address)
        const deadline = new Date(Date.now() + this.callTimeoutMs)

        return await new Promise((resolve, reject) => {
            client.makeUnaryRequest<Uint8Array, Buffer>(
                method,
                (arg: Uint8Array) => Buffer.from(arg),
                (arg: Buffer) => arg,
                request,
                metadata || new Metadata(),
                { deadline },
                (error: ServiceError | null, response?: Buffer) => {
                    if (error) {
                        reject(error)
                    } else if (response) {
                        resolve(response)
                    } else {
                        reject(new Error('No response received'))
                    }
                },
            )
        })
    }

    private getOrCreateClient(address: string): Client {
        let client = this.clientCache.get(address)
        if (!client) {
            client = new Client(address, this.credentials, GRPC_CHANNEL_OPTIONS)
            this.clientCache.set(address, client)
        }

        return client
    }

    /**
     * Creates a reflection client for the gRPC Server Reflection API.
     *
     * WORKAROUND: We load the reflection.proto from @grpc/reflection package
     * The path resolution is fragile but necessary - if @grpc/reflection changes
     * its structure, this will break.
     */
    private getOrCreateReflectionClient(address: string): ReflectionClient {
        let client = this.reflectionClientCache.get(address)
        if (client) {
            return client
        }

        const reflectionProtoPath = this.resolveReflectionProtoPath()
        const packageDefinition = loadSync(reflectionProtoPath, PROTO_LOADER_OPTIONS)
        const grpcObject = loadPackageDefinition(packageDefinition)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ReflectionService = (grpcObject.grpc as any).reflection.v1.ServerReflection as new (
            address: string,
            creds: ChannelCredentials,
        ) => ReflectionClient

        client = new ReflectionService(address, this.credentials)
        this.reflectionClientCache.set(address, client)

        return client
    }

    /**
     * Resolves the path to reflection.proto from @grpc/reflection package.
     *
     * FRAGILE: This depends on @grpc/reflection internal structure.
     * If the package changes, this path resolution will fail.
     */
    private resolveReflectionProtoPath(): string {
        const grpcReflectionDir = path.resolve(path.dirname(require.resolve('@grpc/reflection')), '..')

        return path.join(grpcReflectionDir, 'proto/grpc/reflection/v1/reflection.proto')
    }
}
