import { AsyncLocalStorage } from 'node:async_hooks'

import type { AuthService, IdentifierService } from '@diia-inhouse/crypto'
import type { DatabaseService } from '@diia-inhouse/db'
import type { MetricsService } from '@diia-inhouse/diia-metrics'
import type {
    EventBus,
    EventMessageHandler,
    EventMessageValidator,
    ExternalCommunicator,
    ExternalCommunicatorChannel,
    ExternalEventBus,
    Queue,
    ScheduledTask,
    Task,
} from '@diia-inhouse/diia-queue'
import type { EnvService } from '@diia-inhouse/env'
import type { HealthCheck } from '@diia-inhouse/healthcheck'
import type { CacheService, PubSubService, RedlockService, StoreService } from '@diia-inhouse/redis'
import type { AlsData, Logger } from '@diia-inhouse/types'
import type { AppValidator } from '@diia-inhouse/validators'

import { ActionExecutor } from '../actionExecutor'
import { GrpcService } from '../grpc'
import { GrpcClientFactory } from '../grpc/grpcClient'
import MoleculerService from '../moleculer/moleculerWrapper'

import { BaseConfig } from './config'

export interface BaseDeps<TConfig extends BaseConfig = BaseConfig> {
    serviceName: string
    config: TConfig
    logger: Logger
    envService: EnvService
    asyncLocalStorage: AsyncLocalStorage<AlsData>
    validator: AppValidator
    actionExecutor: ActionExecutor
    metrics: MetricsService
    grpcService: GrpcService
    grpcClientFactory: GrpcClientFactory
    moleculer?: MoleculerService
    store?: StoreService
    redlock?: RedlockService
    cache?: CacheService
    pubsub?: PubSubService
    queue?: Queue
    eventMessageHandler?: EventMessageHandler
    eventMessageValidator?: EventMessageValidator
    externalChannel?: ExternalCommunicatorChannel
    task?: Task
    scheduledTask?: ScheduledTask
    eventBus?: EventBus
    externalEventBus?: ExternalEventBus
    external?: ExternalCommunicator
    healthCheck?: HealthCheck
    database?: DatabaseService
    auth?: AuthService
    identifier?: IdentifierService
}
