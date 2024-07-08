import { randomInt } from 'node:crypto'

import { Application, ServiceContext, ServiceOperator } from '../../src'

import { configFactory } from './config'
import deps from './deps'
import { AppConfig } from './interfaces/config'
import { AppDeps } from './interfaces/deps'

export async function getApp(): Promise<ServiceOperator<AppConfig, AppDeps>> {
    const app = new Application<ServiceContext<AppConfig, AppDeps>>('Auth')

    await app.setConfig(configFactory)
    const config = app.getConfig()
    const grpcPort = randomInt(1000, 9999)

    app.patchConfig({ grpc: { testServiceAddress: `localhost:${grpcPort}` }, grpcServer: { ...config.grpcServer, port: grpcPort } })
    await app.setDeps(deps)
    const appOperator = await app.initialize()

    await appOperator.start()

    return appOperator
}
