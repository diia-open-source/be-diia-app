import { AsyncLocalStorage } from 'async_hooks'

import { MetricsService } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { AlsData, Logger } from '@diia-inhouse/types'
import { AppValidator } from '@diia-inhouse/validators'

import ActionFactory from '../actionFactory'
import { GrpcClientFactory } from '../grpc/grpcClient'
import MoleculerService from '../moleculer/moleculerWrapper'

import { BaseConfig } from './config'

export interface ExternallyRegisteredDeps {
    config: BaseConfig
    logger: Logger
}

export interface InternallyRegisteredDeps {
    serviceName: string
    envService: EnvService
    asyncLocalStorage: AsyncLocalStorage<AlsData>
    moleculer?: MoleculerService
    validator: AppValidator
    actionFactory: ActionFactory
    metrics: MetricsService
    grpcClientFactory: GrpcClientFactory
}

export type BaseDeps = ExternallyRegisteredDeps & InternallyRegisteredDeps
