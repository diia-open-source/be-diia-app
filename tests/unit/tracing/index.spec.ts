import { IncomingMessage } from 'http'

import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

import { getIgnoreIncomingRequestHook, initTracing } from '../../../src'

jest.mock('@opentelemetry/resources', () => {
    const { Resource, ...rest } = jest.requireActual('@opentelemetry/resources')

    return {
        ...rest,
        Resource: class ResourceMock {
            static default(): { merge: () => void } {
                return {
                    merge: (): void => {},
                }
            }
        },
    }
})

jest.mock('@opentelemetry/sdk-trace-node')
jest.mock('@opentelemetry/api')
jest.mock('@opentelemetry/exporter-trace-otlp-grpc')
jest.mock('@opentelemetry/instrumentation')
jest.mock('@opentelemetry/sdk-trace-base')

const defaultConfig = {
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
        initTracing('Documents')

        const { instances: providerInstances } = (<jest.MockedClass<typeof NodeTracerProvider>>NodeTracerProvider).mock

        expect(providerInstances).toHaveLength(0)
    })

    it('should register node tracer provider', () => {
        initTracing('Documents', { enabled: true })

        const [provider] = (<jest.MockedClass<typeof NodeTracerProvider>>NodeTracerProvider).mock.instances

        expect(registerInstrumentations).toHaveBeenCalled()
        expect(OTLPTraceExporter).toHaveBeenCalledWith(defaultConfig.exporter)

        expect(provider.register).toHaveBeenCalled()
    })

    it('should add debug logging', () => {
        initTracing('Documents', { enabled: true, debug: true })

        const [diagConsoleLogger] = (<jest.MockedClass<typeof DiagConsoleLogger>>DiagConsoleLogger).mock.instances
        const [provider] = (<jest.MockedClass<typeof NodeTracerProvider>>NodeTracerProvider).mock.instances
        const [simpleSpanProcessor] = (<jest.MockedClass<typeof SimpleSpanProcessor>>SimpleSpanProcessor).mock.instances
        const [consoleSpanExporter] = (<jest.MockedClass<typeof ConsoleSpanExporter>>ConsoleSpanExporter).mock.instances

        expect(jest.spyOn(diag, 'setLogger')).toHaveBeenCalledWith(diagConsoleLogger, DiagLogLevel.VERBOSE)
        expect(provider.addSpanProcessor).toHaveBeenCalledWith(simpleSpanProcessor)
        expect(SimpleSpanProcessor).toHaveBeenCalledWith(consoleSpanExporter)
        expect(provider.register).toHaveBeenCalled()
    })
})

describe(`getIgnoreIncomingRequestHook`, () => {
    const paths = ['/path1', '/path2']
    const hook = getIgnoreIncomingRequestHook(paths)

    it('should return true if passed url in ignored paths list', () => {
        expect(hook(<IncomingMessage>{ url: paths[0] })).toBe(true)
    })

    it('should return true if passed url in the list of hardcoded ignored paths', () => {
        expect(hook(<IncomingMessage>{ url: '/ready' })).toBe(true)
    })

    it('should return false if passed url not in ignored paths list', () => {
        expect(hook(<IncomingMessage>{ url: '/not0in-list' })).toBe(false)
    })

    it('should return false if url is not passed', () => {
        expect(hook(<IncomingMessage>{})).toBe(false)
    })
})
