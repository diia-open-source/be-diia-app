import { TlsCredentials } from './certificate/provider/provider.types.js'

export interface GrpcTlsServerOptions {
    isEnabled: boolean
    requireClientCert?: boolean
    certs: TlsCredentials
}

export interface GrpcTlsClientOptions {
    isEnabled: boolean
    certs: TlsCredentials
}
