import { asClass, asFunction } from 'awilix'

import { CryptoDeps, HashService, IdentifierService } from '@diia-inhouse/crypto'
import TestKit from '@diia-inhouse/test'

import { DepsFactoryFn, DepsResolver, GrpcClientFactory } from '../../src'
import { TestDefinition } from '../../src/generated'

import { AppConfig } from './interfaces/config'
import { AppDeps } from './interfaces/deps'

export default (config: AppConfig): ReturnType<DepsFactoryFn<AppConfig, AppDeps>> => {
    const { identifier, grpc } = config
    const cryptoDeps: DepsResolver<CryptoDeps> = {
        identifier: asClass(IdentifierService, { injector: () => ({ identifierConfig: identifier }) }).singleton(),
        hash: asClass(HashService).singleton(),
    }

    return <ReturnType<DepsFactoryFn<AppConfig, AppDeps>>>(<unknown>{
        testKit: asClass(TestKit).singleton(),

        testServiceClient: asFunction((grpcClientFactory: GrpcClientFactory) =>
            grpcClientFactory.createGrpcClient(TestDefinition, grpc.testServiceAddress, 'Test'),
        ).singleton(),

        ...cryptoDeps,
    })
}
