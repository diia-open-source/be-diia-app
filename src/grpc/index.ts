import { Metadata } from 'nice-grpc'

import { CallOptions, GrpcClientMetadata } from '../interfaces'

export * from './grpcService'

export * from './grpcClient'

export function clientCallOptions(grpcMetadata: GrpcClientMetadata): CallOptions {
    const metadata = new Metadata()

    const { session, version, deadline } = grpcMetadata

    if (session) {
        metadata.set('session', Buffer.from(JSON.stringify(session)).toString('base64'))
    }

    if (version) {
        metadata.set('actionversion', version)
    }

    return {
        metadata,
        deadline,
    }
}
