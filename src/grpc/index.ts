import { Metadata } from 'nice-grpc'

import { grpcMetadataKeys } from '@diia-inhouse/types'

import { CallOptions, GrpcClientMetadata } from '../interfaces'

export { Metadata as GrpcMetadata } from 'nice-grpc'

export * from './grpcService'

export * from './grpcClient'

export * from './schemaReflection'

export * from './dynamicClient'

export * from './grpcExecutor'

export function clientCallOptions(grpcMetadata: GrpcClientMetadata): CallOptions {
    const metadata = new Metadata()

    const { session, version, deadline } = grpcMetadata

    if (session) {
        metadata.set(grpcMetadataKeys.SESSION, Buffer.from(JSON.stringify(session)).toString('base64'))
    }

    if (version) {
        metadata.set(grpcMetadataKeys.ACTION_VERSION, version)
    }

    return {
        metadata,
        deadline,
    }
}
