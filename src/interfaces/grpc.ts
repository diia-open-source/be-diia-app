import { CallOptions as DefaultGrpcCallOptions } from 'nice-grpc'

import { ActionVersion } from '@diia-inhouse/types'
import { ActionSession } from '@diia-inhouse/types/dist/types/session/session'

export interface GrpcClientMetadata {
    session?: ActionSession
    version?: ActionVersion
    deadline?: number
}

export interface CallOptions extends DefaultGrpcCallOptions {
    deadline?: number
}

export interface GrpcServiceStatus {
    grpcServer: 'UNKNOWN' | 'SERVING' | 'NOT_SERVING'
}
