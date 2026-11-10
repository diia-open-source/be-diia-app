import { ChannelCredentials } from '@grpc/grpc-js'

import { GrpcTlsClientOptions } from './tls.types.js'

export class GrpcTlsCredentialService {
    constructor(private readonly options?: GrpcTlsClientOptions) {}

    createChannelCredentials(): ChannelCredentials {
        if (!this.options?.isEnabled) {
            return ChannelCredentials.createInsecure()
        }

        const { key, cert, rootCert } = this.options.certs

        return ChannelCredentials.createSsl(rootCert, key, cert)
    }
}
