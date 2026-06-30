import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { createContainer } from 'awilix'
import { mock } from 'vitest-mock-extended'

import { Logger } from '@diia-inhouse/types'

import { Application, DepsType, OnStartHooksResult, ServiceContext, asValue } from '../../src'

class FailingStartupApplication extends Application<ServiceContext> {
    protected async runOnStartHooks(): Promise<OnStartHooksResult> {
        throw new Error('startup failed')
    }

    startService(): Promise<OnStartHooksResult> {
        return this['start']()
    }
}

describe(Application.name, () => {
    describe('startup failure handling', () => {
        it('logs the cause and shuts the process down with exit code 1 when startup fails', async () => {
            const logger = mock<Logger>()
            const app = new FailingStartupApplication('Test', mock<NodeTracerProvider>(), {})

            app['baseContainer'].register({ logger: asValue(logger) })
            app.container = createContainer<DepsType<ServiceContext>>()

            let resolveExit: () => void = () => undefined
            const exited = new Promise<void>((resolve) => {
                resolveExit = resolve
            })
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
                resolveExit()
            }) as never)

            void app.startService()
            await exited

            expect(logger.error).toHaveBeenCalledWith('Failed to start service', { err: expect.any(Error) })
            expect(exitSpy).toHaveBeenCalledWith(1)
        })
    })
})
