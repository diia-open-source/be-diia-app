import path from 'node:path'

import { Server, ServerUnaryCall, ServiceDefinition, sendUnaryData } from '@grpc/grpc-js'

import { SchemaRegistry } from './schemaRegistry'
import { JsonSchemaProperty, ServiceSchemaDto } from './types'

const resolveProtoPath = (): string => {
    return path.resolve(__dirname, '../../../proto/schema-reflection.proto')
}

export const schemaReflectionProtoPath = resolveProtoPath()

export class GrpcSchemaService {
    constructor(
        private readonly serviceName: string,
        private readonly version: string,
        private readonly schemaRegistry: SchemaRegistry,
    ) {}

    addToServer(server: Server, service: ServiceDefinition): void {
        server.addService(service, {
            getSchemas: this.handleGetSchemas.bind(this),
        })
    }

    private handleGetSchemas(_call: ServerUnaryCall<unknown, ServiceSchemaDto>, callback: sendUnaryData<ServiceSchemaDto>): void {
        const methods = this.schemaRegistry.getAll()
        const globalDefinitions: Record<string, JsonSchemaProperty> = {}

        const actions = methods
            .filter((m) => m.actionName)
            .map((method) => {
                if (method.requestSchema.definitions) {
                    Object.assign(globalDefinitions, method.requestSchema.definitions)
                }

                if (method.responseSchema.definitions) {
                    Object.assign(globalDefinitions, method.responseSchema.definitions)
                }

                const { definitions: _reqDefs, ...requestSchemaWithoutDefs } = method.requestSchema
                const { definitions: _resDefs, ...responseSchemaWithoutDefs } = method.responseSchema

                return {
                    name: method.actionName || '',
                    grpcMethod: method.grpcMethod,
                    sessionType: method.sessionType || '',
                    requestSchemaJson: JSON.stringify(requestSchemaWithoutDefs),
                    responseSchemaJson: JSON.stringify(responseSchemaWithoutDefs),
                    requestTypeName: method.requestTypeName,
                    responseTypeName: method.responseTypeName,
                    httpMapping: method.httpMapping,
                    description: method.description,
                    deprecated: method.deprecated,
                    requestStream: method.requestStream,
                    responseStream: method.responseStream,
                }
            })

        const response: ServiceSchemaDto = {
            serviceName: this.serviceName,
            version: this.version,
            actions,
            definitionsJson: JSON.stringify(globalDefinitions),
        }

        callback(null, response)
    }
}
