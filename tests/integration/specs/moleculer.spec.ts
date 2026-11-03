import { AsyncLocalStorage } from 'node:async_hooks'

import { ApiError, ErrorType } from '@diia-inhouse/errors'
import TestKit from '@diia-inhouse/test'
import { ActionVersion, AlsData, SessionType } from '@diia-inhouse/types'

import { BaseConfig, MoleculerService } from '../../../src'
import { ACTION_PARAMS } from '../../../src/plugins/pluginConstants'
import { getApp } from '../getApp'

describe('MoleculerService', () => {
    let app: Awaited<ReturnType<typeof getApp>>
    let appNode: MoleculerService
    let client: MoleculerService
    let callOptions: { nodeID: string }

    const testKit = new TestKit()

    const buildClientNode = (): MoleculerService =>
        app.container.build(MoleculerService, {
            injector: () => ({ config: { ...app.container.resolve<BaseConfig>('config'), disableMoleculerActions: true } }),
        })

    const waitUntilDiscovered = async (observer: MoleculerService, nodeID: string): Promise<void> => {
        await vi.waitFor(() => expect(observer.serviceBroker.registry.nodes.get(nodeID)?.available).toBe(true), { timeout: 5000 })
    }

    beforeAll(async () => {
        app = await getApp()
        appNode = app.container.resolve<MoleculerService>('moleculer')
        callOptions = { nodeID: appNode.serviceBroker.nodeID }
        client = buildClientNode()
        await client.onInit()
        await waitUntilDiscovered(client, appNode.serviceBroker.nodeID)
    })

    afterAll(async () => {
        await client.onDestroy()
        await app.stop()
    })

    it.each([{ method: 'act' as const }, { method: 'tryToAct' as const }])(
        'should run an action called by another node through $method and return its result',
        async ({ method }) => {
            const result = await client[method]('Auth', { name: 'echoParams' }, { params: { name: 'a', items: [] } }, callOptions)

            expect(result).toEqual({ paramsJson: '{"name":"a","items":[]}' })
        },
    )

    it("should deliver params, the session and the caller's context headers to the action", async () => {
        const session = testKit.session.getUserSession()
        const asyncLocalStorage = app.container.resolve<AsyncLocalStorage<AlsData>>('asyncLocalStorage')

        const result = await asyncLocalStorage.run({ logData: { traceId: 'from-context', mobileUid: 'mobile-1' } } as AlsData, () =>
            client.act(
                'Auth',
                { name: 'echoArguments', actionVersion: ActionVersion.V1 },
                { params: {}, session, headers: { traceId: 'from-arguments' } },
                callOptions,
            ),
        )

        expect(result).toEqual({
            session: JSON.parse(JSON.stringify(session)),
            headers: { traceId: 'from-arguments', mobileUid: 'mobile-1' },
        })
    })

    describe('errors', () => {
        it("should rethrow the action's ApiError with its code, process code and original type", async () => {
            await expect(
                client.act(
                    'Auth',
                    { name: 'throwError' },
                    {
                        params: { httpStatus: 404, processCode: 1010, type: ErrorType.Operated },
                        session: { sessionType: SessionType.None },
                    },
                    callOptions,
                ),
            ).rejects.toMatchObject({
                message: 'error message',
                code: 404,
                data: { processCode: 1010, opOriginalError: { type: ErrorType.Operated } },
            })
        })

        it("should keep the first hop's original error type", async () => {
            await expect(
                client.act(
                    'Auth',
                    { name: 'throwError' },
                    { params: { httpStatus: 400, type: ErrorType.Unoperated, data: { opOriginalError: { type: ErrorType.Operated } } } },
                    callOptions,
                ),
            ).rejects.toMatchObject({ code: 400, data: { opOriginalError: { type: ErrorType.Operated } } })
        })

        it('should reject with a 404 ApiError when no node serves the action', async () => {
            const call = client.act('Auth', { name: 'noSuchAction' }, {}, callOptions)

            await expect(call).rejects.toBeInstanceOf(ApiError)
            await expect(call).rejects.toMatchObject({ code: 404 })
        })

        it('should resolve tryToAct with nothing when no node serves the action', async () => {
            await expect(client.tryToAct('Auth', { name: 'noSuchAction' }, {}, callOptions)).resolves.toBeUndefined()
        })
    })

    it('should advertise no service from a node whose Moleculer actions are disabled', async () => {
        await waitUntilDiscovered(appNode, client.serviceBroker.nodeID)

        const services = appNode.serviceBroker.registry.nodes.get(client.serviceBroker.nodeID)?.services

        expect(services?.map(({ name }: { name: string }) => name)).toEqual(['$node'])
    })

    it("should advertise each action's validation rules to other nodes", async () => {
        const { services } = client.serviceBroker.registry.nodes.get(callOptions.nodeID).rawInfo as {
            services: { name: string; actions: Record<string, Record<string, unknown>> }[]
        }
        const [auth] = services.filter(({ name }) => name === 'Auth')

        expect(auth.actions['Auth.echoParams.v0'][ACTION_PARAMS]).toEqual({
            params: {
                type: 'object',
                props: {
                    name: { type: 'string' },
                    nickname: { type: 'string', optional: true },
                    nested: { type: 'object', optional: true },
                    items: { type: 'array', optional: true },
                    plain: { type: 'object', optional: true },
                },
            },
        })
    })

    it('should stop answering its peers once the node is stopped', async () => {
        const node = buildClientNode()

        await node.onInit()
        await waitUntilDiscovered(appNode, node.serviceBroker.nodeID)
        await node.onDestroy()

        await expect(appNode.serviceBroker.ping(node.serviceBroker.nodeID, 500)).resolves.toBeNull()
    })

    it('should fail to start when an action locks a resource and no redlock is configured', async () => {
        const node = app.container.build(MoleculerService, { injector: () => ({ redlock: null }) })

        await expect(node.onInit()).rejects.toThrow(new Error('Lock resource cannot be used without a redlock service'))
    })
})
