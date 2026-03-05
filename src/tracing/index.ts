import { DiagConsoleLogger, DiagLogLevel, Span, diag } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import type { ConsumeEndInfo, ConsumeInfo, PublishConfirmedInfo, PublishInfo } from '@opentelemetry/instrumentation-amqplib'
import type { IgnoreIncomingRequestFunction } from '@opentelemetry/instrumentation-http'
import { Resource } from '@opentelemetry/resources'
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { merge } from 'lodash'

import { EnvService } from '@diia-inhouse/env'

import { ATTR_K8S_POD_NAME, OpentelemetryTracingConfig, SEMATTRS_MESSAGING_RABBITMQ_ATTRIBUTES } from '../interfaces/tracing'

let activitiesModule:
    | {
          activityInfo(): {
              workflowExecution?: { workflowId?: string; runId?: string }
              activityId?: string
              activityType?: string
              attempt?: number
          }
      }
    | undefined

try {
    activitiesModule = require('@diia-inhouse/workflow/activity')
} catch {
    // Module is not available, activitiesModule remains undefined
}

export function getIgnoreIncomingRequestHook(paths: string[] = []): IgnoreIncomingRequestFunction {
    const ignoreIncomingPaths = new Set(['/metrics', '/ready', '/start', '/live'].concat(paths))

    return ({ url }) => {
        if (!url) {
            return false
        }

        return ignoreIncomingPaths.has(url)
    }
}

function enrichLogRecordWithActivityInfo(record: Record<string, unknown>): void {
    if (!activitiesModule) {
        return
    }

    try {
        const activity = activitiesModule.activityInfo()

        if (activity) {
            record.workflowId = activity.workflowExecution?.workflowId
            record.runId = activity.workflowExecution?.runId
            record.activityId = activity.activityId
            record.activityType = activity.activityType
            record.attempt = activity.attempt
        }
    } catch {
        // Silently ignore errors when activities aren't available
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
                for (const [key, value] of Object.entries(consumeInfo.msg.properties)) {
                    span.setAttribute(`${SEMATTRS_MESSAGING_RABBITMQ_ATTRIBUTES}.${key}`, value)
                }

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
        '@opentelemetry/instrumentation-pino': {
            logHook: (_, record) => {
                enrichLogRecordWithActivityInfo(record)
            },
        },
    },
    debug: process.env.TRACING_DEBUG_ENABLED ? process.env.TRACING_DEBUG_ENABLED === 'true' : false,
    exporter: {
        url: process.env.TRACING_EXPORTER_URL || 'http://opentelemetry-collector.tracing.svc.cluster.local:4317',
    },
}

export function initTracing(override?: OpentelemetryTracingConfig): NodeTracerProvider {
    const config = {
        ...defaultConfig,
        ...override,
        instrumentations: merge(defaultConfig.instrumentations, override?.instrumentations),
    }

    const systemServiceName = override?.appName || EnvService.getVar('APP_NAME', 'string', null)
    const podName = override?.hostname || EnvService.getVar('POD_NAME', 'string', null)
    const instrumentations = getNodeAutoInstrumentations(config.instrumentations)

    registerInstrumentations({
        instrumentations: [instrumentations],
    })

    if (config.debug) {
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.VERBOSE)
    }

    const resource = Resource.default().merge(
        new Resource({
            [ATTR_SERVICE_NAME]: systemServiceName,
            [ATTR_K8S_POD_NAME]: podName,
        }),
    )

    const spanProcessors = []

    if (config.enabled) {
        const exporter = new OTLPTraceExporter(config.exporter)

        spanProcessors.push(new BatchSpanProcessor(exporter))
    }

    if (config.debug) {
        spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()))
    }

    const provider = new NodeTracerProvider({ resource, spanProcessors })

    provider.register()

    return provider
}
