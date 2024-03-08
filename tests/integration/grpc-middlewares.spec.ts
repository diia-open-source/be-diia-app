import { createServer } from 'nice-grpc'

import { DurationMs } from '@diia-inhouse/types'

import { Application, CallOptions, ServiceContext, clientCallOptions } from '../../src'
import { TestClient, TestDefinition, TestRequest, TestResponse } from '../../src/generated/tests'
import { configFactory } from '../mocks'

import deps from './deps'
import { AppConfig } from './interfaces/config'
import { AppDeps } from './interfaces/deps'

describe('grpc-middlewares', () => {
    const app = new Application<ServiceContext<AppConfig, AppDeps>>('Auth')
    let appOperator: ReturnType<typeof app.initialize>
    let testServiceClient: TestClient<CallOptions>

    const server = createServer()

    server.add(TestDefinition, {
        async request(params: TestRequest) {
            const { timeoutMs } = params

            return await new Promise((resolve) => {
                setTimeout(() => resolve({ status: 'ok' }), timeoutMs)
            })
        },
    })

    beforeAll(async () => {
        appOperator = (await app.setConfig(configFactory)).setDeps(deps).initialize()
        await appOperator.start()
        testServiceClient = appOperator.container.resolve<TestClient<CallOptions>>('testServiceClient')
        const resolvedConfig = appOperator.container.resolve('config')

        await server.listen(resolvedConfig.grpc.testServiceAddress)
    })

    afterAll(async () => {
        await appOperator.stop()
        await server.shutdown()
    })

    describe('deadline', () => {
        it('should return response', async () => {
            // Act
            const result = await testServiceClient.request(
                { timeoutMs: DurationMs.Second },
                clientCallOptions({ deadline: DurationMs.Second * 10 }),
            )

            // Assert
            expect(result).toEqual<TestResponse>({ status: 'ok' })
        })

        it('should return deadline error via clientCallOptions', async () => {
            // Act
            const getError = async (): Promise<Error | undefined> => {
                try {
                    await testServiceClient.request(
                        { timeoutMs: DurationMs.Second * 20 },
                        clientCallOptions({ deadline: DurationMs.Second }),
                    )
                } catch (err) {
                    return <Error>err
                }
            }

            // Assert
            const error = await getError()

            expect(error).toBeTruthy()
        })

        it('should return deadlint error via direct options', async () => {
            // Act
            const getError = async (): Promise<Error | undefined> => {
                try {
                    await testServiceClient.request({ timeoutMs: DurationMs.Second * 20 }, { deadline: DurationMs.Second })
                } catch (err) {
                    return <Error>err
                }
            }

            // Assert
            const error = await getError()

            expect(error).toBeTruthy()
        })
    })
})
