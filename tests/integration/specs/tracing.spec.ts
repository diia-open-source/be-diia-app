import { SpanKind, trace } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

import { ActionVersion } from '@diia-inhouse/types'

import { BaseConfig, MoleculerService } from '../../../src'
import '../../../src/tracing/register'
import EchoArgumentsAction from '../actions/v1/echoArguments'
import GetTestAction from '../actions/v1/getTest'
import { getApp } from '../getApp'

vi.hoisted(() => {
    process.env.APP_NAME = 'auth-service'
    process.env.POD_NAME = 'auth-pod-1'
})

describe('tracing/register', () => {
    let app: Awaited<ReturnType<typeof getApp>>

    beforeAll(async () => {
        app = await getApp()
    })

    afterAll(async () => {
        await app.stop()
    })

    it("should record an action's server span with the service and pod as its resource", async () => {
        const action = app.container.resolve<GetTestAction>('v1GetTestAction')
        let span: ReadableSpan | undefined

        vi.spyOn(action, 'handler').mockImplementationOnce(async () => {
            span = trace.getActiveSpan() as unknown as ReadableSpan

            return { status: 'ok' }
        })

        await app.container.resolve('testServiceClient').getTest({ timeoutMs: 1 })

        expect(span).toMatchObject({ name: 'handle /ua.gov.diia.test.Test/GetTest', kind: SpanKind.SERVER })
        expect(span?.resource.attributes).toMatchObject({ 'service.name': 'auth-service', 'k8s.pod.name': 'auth-pod-1' })
    })

    it("should continue the caller's trace in an action another node calls over Moleculer", async () => {
        const appNode = app.container.resolve<MoleculerService>('moleculer')
        const client = app.container.build(MoleculerService, {
            injector: () => ({ config: { ...app.container.resolve<BaseConfig>('config'), disableMoleculerActions: true } }),
        })
        const action = app.container.resolve<EchoArgumentsAction>('v1EchoArgumentsAction')
        let actionTraceId: string | undefined

        vi.spyOn(action, 'handler').mockImplementationOnce(async ({ session, headers }) => {
            actionTraceId = trace.getActiveSpan()?.spanContext().traceId

            return { session, headers }
        })
        await client.onInit()

        try {
            await vi.waitFor(() => expect(client.serviceBroker.registry.nodes.get(appNode.serviceBroker.nodeID)?.available).toBe(true))

            const callerTraceId = await trace.getTracer('test').startActiveSpan('caller', async (span) => {
                await client.act(
                    'Auth',
                    { name: 'echoArguments', actionVersion: ActionVersion.V1 },
                    {},
                    { nodeID: appNode.serviceBroker.nodeID },
                )
                span.end()

                return span.spanContext().traceId
            })

            expect(actionTraceId).toBe(callerTraceId)
        } finally {
            await client.onDestroy()
        }
    })
})
