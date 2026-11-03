import path from 'node:path'

import { ChannelCredentials, ClientDuplexStream, ServiceClientConstructor, loadPackageDefinition } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'

export interface ServerReflectionRequest {
    list_services?: string
    file_containing_symbol?: string
}

export interface ServerReflectionResponse {
    list_services_response?: { service: { name: string }[] }
    file_descriptor_response?: { file_descriptor_proto: Buffer[] }
    error_response?: { error_code: number }
}

interface ServerReflectionClient {
    ServerReflectionInfo: () => ClientDuplexStream<ServerReflectionRequest, ServerReflectionResponse>
    close: () => void
}

export const loadService = (protoPath: string, servicePath: string[]): ServiceClientConstructor => {
    let definition: unknown = loadPackageDefinition(loadSync(protoPath, { keepCase: true, enums: String }))
    for (const key of servicePath) {
        definition = (definition as Record<string, unknown>)[key]
    }

    return definition as ServiceClientConstructor
}

const ServerReflection = loadService(
    path.resolve(__dirname, '../../node_modules/@grpc/reflection/build/proto/grpc/reflection/v1/reflection.proto'),
    ['grpc', 'reflection', 'v1', 'ServerReflection'],
)

export const reflect = async (port: number, request: ServerReflectionRequest): Promise<ServerReflectionResponse> => {
    const client = new ServerReflection(`localhost:${port}`, ChannelCredentials.createInsecure()) as unknown as ServerReflectionClient
    const call = client.ServerReflectionInfo()
    const { promise, resolve, reject } = Promise.withResolvers<ServerReflectionResponse>()

    call.on('data', resolve)
    call.on('error', reject)
    call.write(request)

    try {
        return await promise
    } finally {
        call.end()
        client.close()
    }
}
