import { NameAndRegistrationPair, asClass, asValue } from 'awilix'

import { MetricsService } from '@diia-inhouse/diia-metrics'
import type { Queue as QueueType } from '@diia-inhouse/diia-queue'
import { AppValidator } from '@diia-inhouse/validators'

import { ActionExecutor } from './actionExecutor'
import { GrpcClientFactory, GrpcService } from './grpc'
import { BaseConfig } from './interfaces'
import { BaseDeps } from './interfaces/deps'
import MoleculerService from './moleculer/moleculerWrapper'

export async function getBaseDeps<TConfig extends BaseConfig = BaseConfig>(
    config: TConfig,
): Promise<NameAndRegistrationPair<BaseDeps<TConfig>>> {
    const { isMoleculerEnabled, healthCheck: healthCheckConfig, store, redis, rabbit, db, auth, identifier, metrics } = config
    const baseDeps: NameAndRegistrationPair<BaseDeps<TConfig>> = {
        config: asValue(config),
        validator: asClass(AppValidator).singleton(),
        actionExecutor: asClass(ActionExecutor).singleton(),
        metrics: asClass(MetricsService, {
            injector: () => ({ metricsConfig: metrics?.custom || {}, isMoleculerEnabled }),
        }).singleton(),
        grpcClientFactory: asClass(GrpcClientFactory).singleton(),
        grpcService: asClass(GrpcService).singleton(),
    }
    if (healthCheckConfig) {
        const { HealthCheck } = await import('@diia-inhouse/healthcheck')

        baseDeps.healthCheck = asClass(HealthCheck, {
            injector: (c) => ({ container: c.cradle, healthCheckConfig }),
        }).singleton()
    }

    if (isMoleculerEnabled) {
        baseDeps.moleculer = asClass(MoleculerService).singleton()
    }

    if (store) {
        const { StoreService, RedlockService } = await import('@diia-inhouse/redis')

        baseDeps.store = asClass(StoreService, { injector: () => ({ storeConfig: store }) }).singleton()
        baseDeps.redlock = asClass(RedlockService, {
            injector: () => ({ storeConfig: store }),
        }).singleton()
    }

    if (redis) {
        const { CacheService, PubSubService } = await import('@diia-inhouse/redis')

        baseDeps.cache = asClass(CacheService, { injector: () => ({ redisConfig: redis }) }).singleton()
        baseDeps.pubsub = asClass(PubSubService, { injector: () => ({ redisConfig: redis }) }).singleton()
    }

    if (rabbit) {
        const {
            ExternalCommunicator,
            ExternalCommunicatorChannel,
            ExternalEventBus,
            ScheduledTask,
            Queue,
            EventMessageHandler,
            EventMessageValidator,
            EventBus,
            Task,
        } = await import('@diia-inhouse/diia-queue')

        baseDeps.queue = asClass(Queue, { injector: () => ({ connectionConfig: rabbit }) }).singleton()
        baseDeps.eventMessageHandler = asClass(EventMessageHandler).singleton()
        baseDeps.eventMessageValidator = asClass(EventMessageValidator).singleton()
        baseDeps.externalChannel = asClass(ExternalCommunicatorChannel).singleton()
        const { internal: internalQueueConfig, external: externalQueueConfig } = rabbit
        if (internalQueueConfig) {
            baseDeps.task = asClass(Task, {
                injector: (c) => ({ queueProvider: c.resolve<QueueType>('queue').getInternalQueue() }),
            }).singleton()

            if (internalQueueConfig.scheduledTaskQueueName) {
                baseDeps.scheduledTask = asClass(ScheduledTask, {
                    injector: (c) => ({
                        queueProvider: c.resolve<QueueType>('queue').getInternalQueue(),
                        queueName: internalQueueConfig.scheduledTaskQueueName,
                    }),
                }).singleton()
            }

            if (internalQueueConfig.queueName) {
                baseDeps.eventBus = asClass(EventBus, {
                    injector: (c) => ({
                        queueProvider: c.resolve<QueueType>('queue').getInternalQueue(),
                        queueName: internalQueueConfig.queueName,
                    }),
                }).singleton()
            }
        }

        if (externalQueueConfig) {
            baseDeps.externalEventBus = asClass(ExternalEventBus, {
                injector: (c) => ({ queueProvider: c.resolve<QueueType>('queue').getExternalQueue() }),
            }).singleton()
            baseDeps.external = asClass(ExternalCommunicator).singleton()
        }
    }

    if (db) {
        const { DatabaseService, DbType } = await import('@diia-inhouse/db')

        baseDeps.database = asClass(DatabaseService, {
            injector: () => ({ dbConfigs: { [DbType.Main]: db } }),
        }).singleton()
    }

    if (auth) {
        const { AuthService } = await import('@diia-inhouse/crypto')

        baseDeps.auth = asClass(AuthService, { injector: () => ({ authConfig: auth }) }).singleton()
    }

    if (identifier) {
        const { IdentifierService } = await import('@diia-inhouse/crypto')

        baseDeps.identifier = asClass(IdentifierService, {
            injector: () => ({ identifierConfig: identifier }),
        }).singleton()
    }

    return baseDeps
}
