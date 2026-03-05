import { IncomingMessage } from 'node:http'

import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

import { getIgnoreIncomingRequestHook, initTracing } from '../../../src'

vi.mock('@opentelemetry/resources', async (importOriginal) => {
    const original = await importOriginal<typeof import('@opentelemetry/resources')>()

    return {
        ...original,
        // eslint-disable-next-line unicorn/no-static-only-class
        Resource: class ResourceMock {
            static default(): { merge: () => void } {
                return {
                    merge: (): void => {},
                }
            }
        },
    }
})

vi.mock('@opentelemetry/sdk-trace-node')
vi.mock('@opentelemetry/api')
vi.mock('@opentelemetry/exporter-trace-otlp-grpc')
vi.mock('@opentelemetry/instrumentation')
vi.mock('@opentelemetry/sdk-trace-base')

const defaultConfig = {
    // eslint-disable-next-line unicorn/no-unused-properties
    instrumentations: {
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': { ignoreIncomingRequestHook: getIgnoreIncomingRequestHook() },
    },
    exporter: {
        url: 'http://opentelemetry-collector.tracing.svc.cluster.local:4317',
    },
}

describe(`initTracing`, () => {
    it('should not register node tracer provider if tracing is disabled', () => {
        initTracing()

        const { instances: providerInstances } = vi.mocked(NodeTracerProvider).mock

        expect(providerInstances).toHaveLength(1)
    })

    it('should register node tracer provider', () => {
        initTracing({ enabled: true })

        expect(registerInstrumentations).toHaveBeenCalled()
        expect(OTLPTraceExporter).toHaveBeenCalledWith(defaultConfig.exporter)
    })

    it('should add debug logging', () => {
        initTracing({ enabled: true, debug: true })

        const [diagConsoleLogger] = vi.mocked(DiagConsoleLogger).mock.instances
        const [simpleSpanProcessor] = vi.mocked(SimpleSpanProcessor).mock.instances
        const [consoleSpanExporter] = vi.mocked(ConsoleSpanExporter).mock.instances
        const [batchSpanProcessor] = vi.mocked(BatchSpanProcessor).mock.instances

        expect(diag.setLogger).toHaveBeenCalledWith(diagConsoleLogger, DiagLogLevel.VERBOSE)
        expect(SimpleSpanProcessor).toHaveBeenCalledWith(consoleSpanExporter)
        expect(NodeTracerProvider).toHaveBeenCalledWith({
            spanProcessors: [batchSpanProcessor, simpleSpanProcessor],
        })
    })
})

describe(`getIgnoreIncomingRequestHook`, () => {
    const paths = ['/path1', '/path2']
    const hook = getIgnoreIncomingRequestHook(paths)

    it('should return true if passed url in ignored paths list', () => {
        expect(hook({ url: paths[0] } as IncomingMessage)).toBe(true)
    })

    it('should return true if passed url in the list of hardcoded ignored paths', () => {
        expect(hook({ url: '/ready' } as IncomingMessage)).toBe(true)
    })

    it('should return false if passed url not in ignored paths list', () => {
        expect(hook({ url: '/not0in-list' } as IncomingMessage)).toBe(false)
    })

    it('should return false if url is not passed', () => {
        expect(hook({} as IncomingMessage)).toBe(false)
    })
})
