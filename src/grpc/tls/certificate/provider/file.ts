import { TlsCertificateProviderOptions, TlsCertificateStrategy, TlsCredentials } from './provider.types.js'

export class GrpcTlsCertificateFileProvider implements TlsCertificateStrategy {
    constructor() {}

    async getCredentials(options: TlsCertificateProviderOptions): Promise<TlsCredentials> {
        const { key, cert, rootCert } = options

        return {
            key: Buffer.from(key),
            cert: Buffer.from(cert),
            rootCert: Buffer.from(rootCert),
        }
    }
}
