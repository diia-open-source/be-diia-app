import { EnvService } from '@diia-inhouse/env'
import { NeverError } from '@diia-inhouse/errors'

import { GrpcTlsCertificateFileProvider } from './file.js'
import { GrpcTlsCertificatePathProvider } from './path.js'
import { TlsCertificateAccessors, TlsCertificateProviderAccessOptions, TlsCredentials } from './provider.types.js'
import { GrpcTlsCertificateSecretProvider } from './secret.js'

export class GrpcTlsCertificateProvider {
    private readonly grpcTlsCertificatePathProvider: GrpcTlsCertificatePathProvider
    private readonly grpcTlsCertificateFileProvider: GrpcTlsCertificateFileProvider
    private readonly grpcTlsCertificateSecretProvider: GrpcTlsCertificateSecretProvider

    constructor(
        private readonly envService: EnvService,
        private readonly options: TlsCertificateProviderAccessOptions,
    ) {
        this.grpcTlsCertificatePathProvider = new GrpcTlsCertificatePathProvider()
        this.grpcTlsCertificateFileProvider = new GrpcTlsCertificateFileProvider()
        this.grpcTlsCertificateSecretProvider = new GrpcTlsCertificateSecretProvider(this.envService)
    }

    async getCredentials(): Promise<TlsCredentials> {
        const { accessor } = this.options

        switch (accessor) {
            case TlsCertificateAccessors.File:
                return await this.grpcTlsCertificateFileProvider.getCredentials(this.options)
            case TlsCertificateAccessors.Path:
                return await this.grpcTlsCertificatePathProvider.getCredentials(this.options)
            case TlsCertificateAccessors.Secret:
                return await this.grpcTlsCertificateSecretProvider.getCredentials(this.options)
            default: {
                throw new NeverError(accessor, 'Unsupported grpctls certificate accessor')
            }
        }
    }
}
