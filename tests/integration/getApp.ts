import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

import { Application, GrpcClientFactory, ServiceContext, ServiceOperator, asFunction } from '../../src'
import { configFactory } from './config'
import deps from './deps'
import { TestDefinition, TestPrivateDefinition } from './generated/test-service'
import { AppConfig } from './interfaces/config'
import { AppDeps } from './interfaces/deps'

const modules = {
    actions: import.meta.glob('/tests/integration/actions/**/*.ts'),
}

export async function getApp(): Promise<ServiceOperator<AppConfig, AppDeps>> {
    const app = new Application<ServiceContext<AppConfig, AppDeps>>('Auth', new NodeTracerProvider(), {})

    await app.setConfig(configFactory)

    await app.setDeps(deps)

    const dynamicDeps = await app.extractDependenciesFromModules(modules, 'tests/integration')
    const appOperator = await app.initialize(dynamicDeps)

    const {
        grpcService: { serverPort },
    } = await appOperator.start()
    if (!serverPort) {
        throw new Error('Grpc server port is not defined. Please check if grpc server is enabled')
    }

    appOperator.container.register({
        grpcServerPort: asFunction(() => serverPort).singleton(),
        testServiceClient: asFunction((grpcClientFactory: GrpcClientFactory) =>
            grpcClientFactory.createGrpcClient(TestDefinition, `localhost:${serverPort}`),
        ).singleton(),
        testPrivateServiceClient: asFunction((grpcClientFactory: GrpcClientFactory) =>
            grpcClientFactory.createGrpcClient(TestPrivateDefinition, `localhost:${serverPort}`),
        ).singleton(),
    })

    return appOperator
}
