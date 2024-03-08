import { DiagConsoleLogger, DiagLogLevel, Span, diag } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { ConsumeEndInfo, ConsumeInfo, PublishConfirmedInfo, PublishInfo } from '@opentelemetry/instrumentation-amqplib'
import { IgnoreIncomingRequestFunction } from '@opentelemetry/instrumentation-http'
import { Resource } from '@opentelemetry/resources'
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { merge } from 'lodash'

import { OpentelemetryTracingConfig } from '../interfaces/tracing'

export function getIgnoreIncomingRequestHook(paths: string[] = []): IgnoreIncomingRequestFunction {
    const ignoreIncomingPaths = ['/metrics', '/ready', '/start', '/live'].concat(paths)

    return ({ url }) => {
        if (!url) {
            return false
        }

        return ignoreIncomingPaths.includes(url)
    }
}

const defaultConfig: OpentelemetryTracingConfig = {
    enabled: process.env.TRACING_ENABLED ? process.env.TRACING_ENABLED === 'true' : false,
    instrumentations: {
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': { ignoreIncomingRequestHook: getIgnoreIncomingRequestHook() },
        '@opentelemetry/instrumentation-amqplib': {
            publishHook: (span: Span, publishInfo: PublishInfo) => {
                if (publishInfo.exchange.includes('reply-to') || publishInfo.routingKey.includes('reply-to')) {
                    span.updateName('amq.rabbitmq.reply-to')
                    span.setAttributes({
                        originalExchange: publishInfo.exchange,
                        originalRoutingKey: publishInfo.routingKey,
                    })
                }
            },
            publishConfirmHook: (span: Span, publishConfirmedInto: PublishConfirmedInfo) => {
                if (publishConfirmedInto.exchange.includes('reply-to') || publishConfirmedInto.routingKey.includes('reply-to')) {
                    span.updateName('amq.rabbitmq.reply-to')
                    span.setAttributes({
                        originalExchange: publishConfirmedInto.exchange,
                        originalRoutingKey: publishConfirmedInto.routingKey,
                    })
                }
            },
            consumeHook: (span: Span, consumeInfo: ConsumeInfo) => {
                if (consumeInfo.msg.fields.exchange.includes('reply-to') || consumeInfo.msg.fields.routingKey.includes('reply-to')) {
                    span.updateName('amq.rabbitmq.reply-to')
                    span.setAttributes({
                        originalExchange: consumeInfo.msg.fields.exchange,
                        originalRoutingKey: consumeInfo.msg.fields.routingKey,
                    })
                }
            },
            consumeEndHook: (span: Span, consumeEndInfo: ConsumeEndInfo) => {
                if (consumeEndInfo.msg.fields.exchange.includes('reply-to') || consumeEndInfo.msg.fields.routingKey.includes('reply-to')) {
                    span.updateName('amq.rabbitmq.reply-to')
                    span.setAttributes({
                        originalExchange: consumeEndInfo.msg.fields.exchange,
                        originalRoutingKey: consumeEndInfo.msg.fields.routingKey,
                    })
                }
            },
        },
    },
    debug: process.env.TRACING_DEBUG_ENABLED ? process.env.TRACING_DEBUG_ENABLED === 'true' : false,
    exporter: {
        url: process.env.TRACING_EXPORTER_URL || 'http://opentelemetry-collector.tracing.svc.cluster.local:4317',
    },
}

export function initTracing(serviceName: string, override?: OpentelemetryTracingConfig): void {
    const config = {
        ...defaultConfig,
        ...override,
        instrumentations: merge(defaultConfig.instrumentations, override?.instrumentations),
    }

    if (!config.enabled) {
        return
    }

    const instrumentations = getNodeAutoInstrumentations(config.instrumentations)

    registerInstrumentations({
        instrumentations: [instrumentations],
    })

    if (config.debug) {
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.VERBOSE)
    }

    const resource = Resource.default().merge(
        new Resource({
            [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        }),
    )
    const exporter = new OTLPTraceExporter(config.exporter)

    const provider = new NodeTracerProvider({ resource })

    provider.addSpanProcessor(new BatchSpanProcessor(exporter))

    if (config.debug) {
        provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()))
    }

    provider.register()
}
