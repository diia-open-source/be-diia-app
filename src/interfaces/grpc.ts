import { ServiceDefinition, UntypedServiceImplementation } from '@grpc/grpc-js'
import { CallOptions as DefaultGrpcCallOptions } from 'nice-grpc'

import { ActionVersion } from '@diia-inhouse/types'
import { ActionSession } from '@diia-inhouse/types/dist/types/session/session'

export interface GrpcClientConfig {
    defaultDeadlineMs?: number
}

export interface GrpcServerConfig {
    isEnabled: boolean
    port: number
    services: string[]
    isReflectionEnabled: boolean
    maxReceiveMessageLength: number
    keepAlive?: GrpcServerKeepalive
}

export interface GrpcServerKeepalive {
    interval?: number
    timeout?: number
    permitWithoutcalls?: 0 | 1
}

export interface GrpcClientMetadata {
    /** @deprecated params should be provided explicitly without a session as sessions are not a part of proto contracts */
    session?: ActionSession
    /** @deprecated a method that contains a version in his name should be used */
    version?: ActionVersion
    deadline?: number
}

export interface CallOptions extends DefaultGrpcCallOptions {
    deadline?: number
}

export interface GrpcServiceStatus {
    grpcServer: 'UNKNOWN' | 'SERVING' | 'NOT_SERVING' | 'DISABLED'
}

export enum GrpcMethodType {
    UNARY,
    CLIENT_STREAM,
    SERVER_STREAM,
    BIDI_STREAM,
}

export interface StreamKey {
    streamId: string
    mobileUid: string
}

export enum DeviceMultipleConnectionPolicy {
    ALLOW_MULTIPLE_CONNECTIONS,
    FORBID_REJECT_NEW_CONNECTION,
    FORBID_CLOSE_PREVIOUS_CONNECTION,
}

export type GrpcServiceImplementationProvider = (service: ServiceDefinition) => UntypedServiceImplementation
