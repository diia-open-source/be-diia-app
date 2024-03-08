import { InstrumentationConfigMap } from '@opentelemetry/auto-instrumentations-node'
import { OTLPGRPCExporterConfigNode } from '@opentelemetry/otlp-grpc-exporter-base'

export interface OpentelemetryTracingConfig {
    enabled?: boolean
    instrumentations?: InstrumentationConfigMap
    exporter?: OTLPGRPCExporterConfigNode
    debug?: boolean
}
