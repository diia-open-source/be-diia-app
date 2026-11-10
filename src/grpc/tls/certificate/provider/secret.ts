import { EnvService } from '@diia-inhouse/env'

import { TlsCertificateProviderOptions, TlsCertificateStrategy, TlsCredentials } from './provider.types.js'

export class GrpcTlsCertificateSecretProvider implements TlsCertificateStrategy {
    constructor(private readonly envService: EnvService) {}

    async getCredentials(options: TlsCertificateProviderOptions): Promise<TlsCredentials> {
        const { key, cert, rootCert } = options

        const [keySecret, certSecret, rootCertSecret] = await Promise.all([
            this.envService.getSecret(key),
            this.envService.getSecret(cert),
            this.envService.getSecret(rootCert),
        ])

        return {
            key: Buffer.from(keySecret),
            cert: Buffer.from(certSecret),
            rootCert: Buffer.from(rootCertSecret),
        }
    }
}
