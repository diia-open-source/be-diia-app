import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { TlsCertificateProviderOptions, TlsCertificateStrategy, TlsCredentials } from './provider.types.js'

export class GrpcTlsCertificatePathProvider implements TlsCertificateStrategy {
    constructor() {}

    async getCredentials(options: TlsCertificateProviderOptions): Promise<TlsCredentials> {
        const { dir, key: keyPath, cert: certPath, rootCert: rootCertPath } = options

        const fullKeyPath = dir ? resolve(dir, keyPath) : keyPath
        const fullCertPath = dir ? resolve(dir, certPath) : certPath
        const fullRootCertPath = dir ? resolve(dir, rootCertPath) : rootCertPath

        const [key, cert, rootCert] = await Promise.all([
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            readFile(fullKeyPath), // nosemgrep: eslint.detect-non-literal-fs-filename
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            readFile(fullCertPath), // nosemgrep: eslint.detect-non-literal-fs-filename
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            readFile(fullRootCertPath), // nosemgrep: eslint.detect-non-literal-fs-filename
        ])

        return {
            key: Buffer.from(key),
            cert: Buffer.from(cert),
            rootCert: Buffer.from(rootCert),
        }
    }
}
