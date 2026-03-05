import { InstrumentationConfigMap } from '@opentelemetry/auto-instrumentations-node'
import type { OTLPGRPCExporterConfigNode } from '@opentelemetry/otlp-grpc-exporter-base'

export { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

export interface OpentelemetryTracingConfig {
    enabled?: boolean
    instrumentations?: InstrumentationConfigMap
    exporter?: OTLPGRPCExporterConfigNode
    debug?: boolean
    appName?: string
    hostname?: string
}

export const SEMATTRS_MESSAGING_RABBITMQ_ATTRIBUTES = 'messaging.rabbitmq.attributes'

// this file partially copies following attribute library
// https://github.com/open-telemetry/opentelemetry-js/blob/b6fa2b9e4d9a41e98408e724e11dc9ce2f38dd91/semantic-conventions/src/experimental_attributes.ts
// as per official guide https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv

export const ATTR_K8S_POD_NAME = 'k8s.pod.name' as const

export const ATTR_MESSAGING_SYSTEM = 'messaging.system' as const

export const ATTR_MESSAGE_ID = 'message.id' as const

export const ATTR_MESSAGE_TYPE = 'message.type' as const

export const ATTR_RPC_SYSTEM = 'rpc.system' as const

export const ATTR_MESSAGING_DESTINATION_NAME = 'messaging.destination.name' as const

export const ATTR_RPC_GRPC_DESTINATION_SERVICE_NAME = 'rpc.grpc.request.service.name' as const

export const ATTR_RPC_GRPC_REQUEST_METADATA = (key: string): string => `rpc.grpc.request.metadata.${key}`
