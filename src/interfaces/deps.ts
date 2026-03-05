import { AsyncLocalStorage } from 'node:async_hooks'

import type { AuthService, IdentifierService } from '@diia-inhouse/crypto'
import type { DatabaseAdapterType, DatabaseService, PostgresDatabaseService } from '@diia-inhouse/db'
import type { MetricsService } from '@diia-inhouse/diia-metrics'
import type {
    EventBus,
    EventMessageHandler,
    EventMessageValidator,
    ExternalCommunicator,
    ExternalEventBus,
    Queue,
    ScheduledTask,
    Task,
} from '@diia-inhouse/diia-queue'
import type { EnvService } from '@diia-inhouse/env'
import type { FeatureService } from '@diia-inhouse/features'
import type { HealthCheck } from '@diia-inhouse/healthcheck'
import type { PubSubService, RedlockService, StoreService } from '@diia-inhouse/redis'
import type { AlsData, Logger } from '@diia-inhouse/types'
import { Utils } from '@diia-inhouse/utils'
import type { AppValidator } from '@diia-inhouse/validators'

import { ActionExecutor } from '../actionExecutor'
import { GrpcService } from '../grpc'
import { GrpcClientFactory } from '../grpc/grpcClient'
import MoleculerService from '../moleculer/moleculerWrapper'
import { BaseConfig } from './config'

export interface BaseDeps<TConfig extends BaseConfig = BaseConfig> {
    serviceName: string
    systemServiceName: string
    hostName: string
    config: TConfig
    logger: Logger
    envService: EnvService
    asyncLocalStorage: AsyncLocalStorage<AlsData>
    validator: AppValidator
    actionExecutor: ActionExecutor
    metrics: MetricsService
    grpcService: GrpcService
    grpcClientFactory: GrpcClientFactory
    utils: Utils
    moleculer?: MoleculerService
    store?: StoreService
    redlock?: RedlockService
    pubsub?: PubSubService
    queue?: Queue
    eventMessageHandler?: EventMessageHandler
    eventMessageValidator?: EventMessageValidator
    task?: Task
    scheduledTask?: ScheduledTask
    eventBus?: EventBus
    externalEventBus?: ExternalEventBus
    external?: ExternalCommunicator
    healthCheck?: HealthCheck
    databaseAdapter?: DatabaseAdapterType
    database?: DatabaseService
    postgresDatabaseService?: PostgresDatabaseService
    auth?: AuthService
    identifier?: IdentifierService
    featureFlag?: FeatureService
}
