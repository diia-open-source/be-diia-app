import { NameAndRegistrationPair, asClass, asValue } from 'awilix'

import { MetricsService } from '@diia-inhouse/diia-metrics'
import type { Queue as QueueType } from '@diia-inhouse/diia-queue'
import { Utils } from '@diia-inhouse/utils'
import { AppValidator } from '@diia-inhouse/validators'

import { ActionExecutor } from './actionExecutor'
import { GrpcClientFactory, GrpcService } from './grpc'
import { BaseConfig } from './interfaces'
import { BaseDeps } from './interfaces/deps'
import MoleculerService from './moleculer/moleculerWrapper'

export async function getBaseDeps<TConfig extends BaseConfig = BaseConfig>(
    config: TConfig,
): Promise<NameAndRegistrationPair<BaseDeps<TConfig>>> {
    const {
        isMoleculerEnabled,
        healthCheck: healthCheckConfig,
        store,
        rabbit,
        databaseAdapter,
        db,
        postgres,
        auth,
        identifier,
        metrics,
        featureFlags,
    } = config
    const baseDeps: NameAndRegistrationPair<BaseDeps<TConfig>> = {
        config: asValue(config),
        validator: asClass(AppValidator).singleton(),
        actionExecutor: asClass(ActionExecutor).singleton(),
        metrics: asClass(MetricsService, {
            injector: () => ({ metricsConfig: metrics?.custom || {} }),
        }).singleton(),
        grpcClientFactory: asClass(GrpcClientFactory).singleton(),
        grpcService: asClass(GrpcService).singleton(),
        utils: asClass(Utils).singleton(),
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
        const { StoreService, RedlockService, PubSubService } = await import('@diia-inhouse/redis')

        baseDeps.store = asClass(StoreService, { injector: () => ({ storeConfig: store }) }).singleton()
        baseDeps.redlock = asClass(RedlockService, {
            injector: () => ({ storeConfig: store }),
        }).singleton()
        baseDeps.pubsub = asClass(PubSubService, { injector: () => ({ redisConfig: store }) }).singleton()
    }

    if (rabbit) {
        const { ExternalCommunicator, ExternalEventBus, ScheduledTask, Queue, EventMessageHandler, EventMessageValidator, EventBus, Task } =
            await import('@diia-inhouse/diia-queue')

        baseDeps.queue = asClass(Queue, { injector: () => ({ connectionConfig: rabbit }) }).singleton()
        baseDeps.eventMessageHandler = asClass(EventMessageHandler).singleton()
        baseDeps.eventMessageValidator = asClass(EventMessageValidator).singleton()
        const { internal: internalQueueConfig, external: externalQueueConfig } = rabbit
        if (internalQueueConfig) {
            baseDeps.task = asClass(Task, {
                injector: (c) => ({ queueProvider: c.resolve<QueueType>('queue').makeInternalRabbitMQProvider('task') }),
            }).singleton()

            if (internalQueueConfig.scheduledTaskQueueName) {
                baseDeps.scheduledTask = asClass(ScheduledTask, {
                    injector: (c) => ({
                        queueProvider: c.resolve<QueueType>('queue').makeInternalRabbitMQProvider('scheduledTask'),
                        queueName: internalQueueConfig.scheduledTaskQueueName,
                    }),
                }).singleton()
            }

            baseDeps.eventBus = asClass(EventBus, {
                injector: (c) => ({
                    queueProvider: c.resolve<QueueType>('queue').makeInternalRabbitMQProvider('eventBus'),
                    queueName: internalQueueConfig.queueName,
                }),
            }).singleton()
        }

        if (externalQueueConfig) {
            baseDeps.externalEventBus = asClass(ExternalEventBus, {
                injector: (c) => ({ queueProvider: c.resolve<QueueType>('queue').makeExternalRabbitMQProvider('externalEventBus') }),
            }).singleton()
            baseDeps.external = asClass(ExternalCommunicator).singleton()
        }
    }

    baseDeps.databaseAdapter = asValue(databaseAdapter ?? 'mongo')

    if (db) {
        const { DatabaseService, DbType } = await import('@diia-inhouse/db')

        baseDeps.database = asClass(DatabaseService, {
            injector: () => ({ dbConfigs: { [DbType.Main]: db } }),
        }).singleton()
    }

    if (postgres) {
        const { PostgresDatabaseService } = await import('@diia-inhouse/db')

        baseDeps.postgresDatabaseService = asClass(PostgresDatabaseService).singleton()
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

    if (featureFlags) {
        const { FeatureService } = await import('@diia-inhouse/features')

        baseDeps.featureFlag = asClass(FeatureService, {
            injector: () => ({ featureConfig: featureFlags }),
        }).singleton()
    }

    return baseDeps
}
