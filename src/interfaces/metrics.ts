import { KeysOfUnion } from 'type-fest'

import { Env } from '@diia-inhouse/env'

export const MetricNames = {
    NodeEnv: 'diia_node_env',
    GrpcStreamConnections: 'diia_grpc_stream_connections',
    GrpcStreamPendingClose: 'diia_grpc_stream_pending_close',
} as const

export const MetricDescriptions = {
    NodeEnv: 'Indicates the NODE_ENV environment value',
    GrpcStreamConnections: 'Number of active gRPC server-stream connections',
    GrpcStreamPendingClose: 'Number of gRPC server-stream connections awaiting close handler completion',
} as const

export class NodeEnvLabelsMapConcrete {
    env: string = Env.Local
}

export type NodeEnvLabelsMap = NodeEnvLabelsMapConcrete

export const nodeEnvAllowedFields = Object.keys(new NodeEnvLabelsMapConcrete()) as KeysOfUnion<NodeEnvLabelsMap>[]

export class GrpcStreamMetricLabelsMapConcrete {
    service = ''
}

export type GrpcStreamMetricLabelsMap = GrpcStreamMetricLabelsMapConcrete

export const grpcStreamMetricAllowedFields = Object.keys(
    new GrpcStreamMetricLabelsMapConcrete(),
) as KeysOfUnion<GrpcStreamMetricLabelsMap>[]
