export interface TlsCredentials {
    key: Buffer
    cert: Buffer
    rootCert: Buffer
}

export interface TlsCertificateProviderOptions {
    dir?: string
    key: string
    cert: string
    rootCert: string
}

export interface TlsCertificateStrategy {
    getCredentials(options: TlsCertificateProviderOptions): Promise<TlsCredentials>
}

export const TlsCertificateAccessors = {
    Path: 'path',
    File: 'file',
    Secret: 'secret',
} as const

export type TlsCertificateAccessor = (typeof TlsCertificateAccessors)[keyof typeof TlsCertificateAccessors]

export interface TlsCertificateProviderAccessOptions extends TlsCertificateProviderOptions {
    accessor: TlsCertificateAccessor
}
