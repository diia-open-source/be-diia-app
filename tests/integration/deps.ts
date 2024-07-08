import { asClass, asFunction } from 'awilix'

import { HashService } from '@diia-inhouse/crypto'

import { DepsFactoryFn, GrpcClientFactory } from '../../src'

import { TestDefinition, TestPrivateDefinition } from './generated/test-service'
import { AppConfig } from './interfaces/config'
import { AppDeps } from './interfaces/deps'

export default async (config: AppConfig): ReturnType<DepsFactoryFn<AppConfig, AppDeps>> => {
    const { grpc } = config

    return {
        testServiceClient: asFunction((grpcClientFactory: GrpcClientFactory) =>
            grpcClientFactory.createGrpcClient(TestDefinition, grpc.testServiceAddress),
        ).singleton(),
        testPrivateServiceClient: asFunction((grpcClientFactory: GrpcClientFactory) =>
            grpcClientFactory.createGrpcClient(TestPrivateDefinition, grpc.testServiceAddress),
        ).singleton(),

        hash: asClass(HashService).singleton(),
    }
}
