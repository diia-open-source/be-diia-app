import { EnvService } from '@diia-inhouse/env'

import { GrpcTlsCertificateProvider, TlsCertificateAccessors } from '../../../../../src'
import { BaseConfig } from '../../../../../src/interfaces'
import { configFactory } from '../../../config'
import { generateTlsFixtures } from './fixtures'

const TLS_FIXTURES_DIR = 'fixtures/tls'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const tlsConfigFactory = async (envService: EnvService, serviceName: string) => {
    generateTlsFixtures(TLS_FIXTURES_DIR)

    const baseConfig = await configFactory(envService, serviceName)

    const serverTlsProviderOptions = {
        key: 'server.key',
        cert: 'server.crt',
        rootCert: 'ca.crt',
        dir: TLS_FIXTURES_DIR,
        accessor: TlsCertificateAccessors.Path,
    }

    const clientTlsProviderOptions = {
        key: 'client.key',
        cert: 'client.crt',
        rootCert: 'ca.crt',
        dir: TLS_FIXTURES_DIR,
        accessor: TlsCertificateAccessors.Path,
    }

    const [serverTls, clientTls] = await Promise.all([
        new GrpcTlsCertificateProvider(envService, serverTlsProviderOptions).getCredentials(),
        new GrpcTlsCertificateProvider(envService, clientTlsProviderOptions).getCredentials(),
    ])

    return {
        ...baseConfig,
        grpcClient: {
            ...baseConfig.grpcClient,
            tls: { isEnabled: true, certs: clientTls },
        },
        grpcServer: {
            ...baseConfig.grpcServer,
            tls: { isEnabled: true, certs: serverTls, requireClientCert: true },
        },
    } satisfies BaseConfig & Record<string, unknown>
}
