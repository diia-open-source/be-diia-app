import { PackageDefinition } from '@grpc/proto-loader'

import type { Logger } from '@diia-inhouse/types'

import { JsonSchemaGenerator } from './jsonSchemaGenerator'
import { ProtoMetadataExtractor } from './protoMetadataExtractor'
import { SchemaRegistry } from './schemaRegistry'
import { GrpcMethodDefinition, HttpMapping, extractHttpMapping } from './types'

interface MethodFromPkgDef {
    path: string
    requestTypeName: string
    responseTypeName: string
    httpMapping?: HttpMapping
    requestStream?: boolean
    responseStream?: boolean
}

export class SchemaReflectionInitializer {
    static async initialize(
        protoPaths: string[],
        includeDirs: string[],
        pkgDefs: PackageDefinition,
        registry: SchemaRegistry,
        logger?: Logger,
    ): Promise<void> {
        const extractor = new ProtoMetadataExtractor(logger)
        const metadata = await extractor.extract(protoPaths, includeDirs)

        const generator = new JsonSchemaGenerator(metadata.root, metadata.fieldComments, metadata.messageComments)
        const methods = this.extractMethodsFromPkgDefs(pkgDefs)

        for (const method of methods) {
            registry.register({
                grpcMethod: method.path,
                requestSchema: generator.generateSchema(method.requestTypeName),
                responseSchema: generator.generateSchema(method.responseTypeName),
                requestTypeName: method.requestTypeName,
                responseTypeName: method.responseTypeName,
                httpMapping: method.httpMapping,
                description: metadata.methodDescriptions.get(method.path),
                requestStream: method.requestStream,
                responseStream: method.responseStream,
            })
        }
    }

    private static extractMethodsFromPkgDefs(pkgDefs: PackageDefinition): MethodFromPkgDef[] {
        if (!pkgDefs) {
            return []
        }

        const methods: MethodFromPkgDef[] = []

        for (const definition of Object.values(pkgDefs)) {
            if (this.isMethodDefinition(definition)) {
                methods.push(this.extractMethodInfo(definition))
                continue
            }

            if (typeof definition === 'object' && definition !== null) {
                for (const methodDef of Object.values(definition)) {
                    if (this.isMethodDefinition(methodDef)) {
                        methods.push(this.extractMethodInfo(methodDef))
                    }
                }
            }
        }

        return methods
    }

    private static isMethodDefinition(def: unknown): def is GrpcMethodDefinition {
        return typeof def === 'object' && def !== null && 'path' in def && 'requestType' in def && 'responseType' in def
    }

    private static extractMethodInfo(def: GrpcMethodDefinition): MethodFromPkgDef {
        return {
            path: def.path,
            requestTypeName: def.requestType?.type?.name || '',
            responseTypeName: def.responseType?.type?.name || '',
            httpMapping: extractHttpMapping(def.options),
            requestStream: def.requestStream,
            responseStream: def.responseStream,
        }
    }
}
