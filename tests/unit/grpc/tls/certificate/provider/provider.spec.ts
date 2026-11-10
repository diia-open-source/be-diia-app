import { PathLike } from 'node:fs'
import { FileHandle, readFile } from 'node:fs/promises'

import { mock } from 'vitest-mock-extended'

import { EnvService } from '@diia-inhouse/env'

import {
    GrpcTlsCertificateProvider,
    TlsCertificateAccessors,
    TlsCertificateProviderAccessOptions,
    TlsCertificateProviderOptions,
} from '../../../../../../src'
import { lookupOrThrow } from './provider.utils'

vi.mock('node:fs/promises', () => ({
    readFile: vi.fn<(path: string) => Promise<Buffer>>(),
}))

describe(`${GrpcTlsCertificateProvider.name} provider`, () => {
    const envService = mock<EnvService>()

    const keyPem = '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----'
    const certPem = '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----'
    const rootCertPem = '-----BEGIN CERTIFICATE-----\nroot\n-----END CERTIFICATE-----'

    describe(`${TlsCertificateAccessors.Secret} accessor`, () => {
        const envNames = { rootCert: 'ROOT_CERT_ENV', cert: 'CERT_ENV', key: 'KEY_ENV' }

        const providerOptions = { accessor: TlsCertificateAccessors.Secret, ...envNames }

        const provider = new GrpcTlsCertificateProvider(envService, providerOptions)

        it('should return inline PEM secrets as buffers without touching the filesystem', async () => {
            // Arrange
            const pemByEnv = new Map<PathLike, string>([
                [envNames.rootCert, rootCertPem],
                [envNames.cert, certPem],
                [envNames.key, keyPem],
            ])

            envService.getSecret.mockImplementation(lookupOrThrow(pemByEnv, 'env name'))

            // Act
            const result = await provider.getCredentials()

            // Assert
            expect(result).toEqual({
                key: Buffer.from(keyPem),
                cert: Buffer.from(certPem),
                rootCert: Buffer.from(rootCertPem),
            })
            expect(readFile).not.toHaveBeenCalled()
        })
    })

    describe(`${TlsCertificateAccessors.Path} accessor`, () => {
        const pemOptions: TlsCertificateProviderOptions = {
            key: '/etc/tls/key.pem',
            cert: '/etc/tls/cert.pem',
            rootCert: '/etc/tls/root.pem',
        }

        const providerOptions: TlsCertificateProviderAccessOptions = {
            ...pemOptions,
            accessor: TlsCertificateAccessors.Path,
        }

        const provider = new GrpcTlsCertificateProvider(envService, providerOptions)

        it('should read the secret value from disk when it is a file path rather than inline PEM content', async () => {
            // Arrange
            const fileByPath = new Map<PathLike, string>([
                [pemOptions.key, keyPem],
                [pemOptions.cert, certPem],
                [pemOptions.rootCert, rootCertPem],
            ])

            vi.mocked(readFile).mockImplementation(async (path: PathLike | FileHandle) => {
                const file = await lookupOrThrow(fileByPath, 'path')(path)

                return Buffer.from(file)
            })

            // Act
            const result = await provider.getCredentials()

            // Assert
            expect(result).toEqual({
                key: Buffer.from(keyPem),
                cert: Buffer.from(certPem),
                rootCert: Buffer.from(rootCertPem),
            })
            expect(readFile).toHaveBeenCalledTimes(3)
            expect(readFile).toHaveBeenNthCalledWith(1, pemOptions.key)
            expect(readFile).toHaveBeenNthCalledWith(2, pemOptions.cert)
            expect(readFile).toHaveBeenNthCalledWith(3, pemOptions.rootCert)

            expect(envService.getSecret).not.toHaveBeenCalled()
        })

        it('should propagate a filesystem error when the path does not resolve to a real file', async () => {
            // Arrange
            vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file or directory'))

            // Act & Assert
            await expect(provider.getCredentials()).rejects.toThrow('ENOENT: no such file or directory')
        })
    })
})
