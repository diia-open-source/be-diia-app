import { IdentifierConfig } from '@diia-inhouse/crypto'
import { AppDbConfig, ReplicaSetNodeConfig } from '@diia-inhouse/db'
import {
    InternalQueueName,
    ListenerOptions,
    QueueConnectionConfig,
    QueueConnectionType,
    ScheduledTaskQueueName,
} from '@diia-inhouse/diia-queue'
import { EnvService } from '@diia-inhouse/env'
import { HealthCheckConfig } from '@diia-inhouse/healthcheck'
import { RedisConfig } from '@diia-inhouse/redis'

import { BalancingStrategy, MetricsConfig, TransporterConfig } from '../../src/interfaces'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const configFactory = async (envService: EnvService, serviceName: string) => ({
    isMoleculerEnabled: true,

    transporter: <TransporterConfig>{
        type: envService.getVar('TRANSPORT_TYPE'),
        options: process.env.TRANSPORT_OPTIONS ? envService.getVar('TRANSPORT_OPTIONS', 'object') : {},
    },

    balancing: <BalancingStrategy>{
        strategy: process.env.BALANCING_STRATEGY_NAME,
        strategyOptions: process.env.BALANCING_STRATEGY_OPTIONS ? JSON.parse(process.env.BALANCING_STRATEGY_OPTIONS) : {},
    },

    db: <AppDbConfig>{
        database: process.env.MONGO_DATABASE,
        replicaSet: process.env.MONGO_REPLICA_SET,
        user: process.env.MONGO_USER,
        password: process.env.MONGO_PASSWORD,
        authSource: process.env.MONGO_AUTH_SOURCE,
        port: envService.getVar('MONGO_PORT', 'number'),
        replicaSetNodes: envService
            .getVar('MONGO_HOSTS', 'string')
            .split(',')
            .map((replicaHost: string): ReplicaSetNodeConfig => ({ replicaHost })),
        readPreference: process.env.MONGO_READ_PREFERENCE,
        indexes: {
            sync: process.env.MONGO_INDEXES_SYNC === 'true',
            exitAfterSync: process.env.MONGO_INDEXES_EXIT_AFTER_SYNC === 'true',
        },
    },

    redis: <RedisConfig>{
        readWrite: envService.getVar('REDIS_READ_WRITE_OPTIONS', 'object'),

        readOnly: envService.getVar('REDIS_READ_ONLY_OPTIONS', 'object'),
    },

    store: <RedisConfig>{
        readWrite: envService.getVar('STORE_READ_WRITE_OPTIONS', 'object'),

        readOnly: envService.getVar('STORE_READ_ONLY_OPTIONS', 'object'),
    },

    rabbit: <QueueConnectionConfig>{
        [QueueConnectionType.Internal]: {
            queueName: InternalQueueName.QueueAuth,
            connection: {
                hostname: process.env.RABBIT_HOST,
                port: process.env.RABBIT_PORT ? parseInt(process.env.RABBIT_PORT, 10) : undefined,
                username: process.env.RABBIT_USERNAME,
                password: process.env.RABBIT_PASSWORD,
                heartbeat: process.env.RABBIT_HEARTBEAT ? parseInt(process.env.RABBIT_HEARTBEAT, 10) : undefined,
            },
            socketOptions: {
                clientProperties: {
                    applicationName: `${serviceName} Service`,
                },
            },
            reconnectOptions: {
                reconnectEnabled: true,
            },
            listenerOptions: <ListenerOptions>{
                prefetchCount: process.env.RABBIT_QUEUE_PREFETCH_COUNT ? parseInt(process.env.RABBIT_QUEUE_PREFETCH_COUNT, 10) : 10,
            },
            scheduledTaskQueueName: ScheduledTaskQueueName.ScheduledTasksQueueAuth,
        },
        [QueueConnectionType.External]: {
            connection: {
                hostname: process.env.EXTERNAL_RABBIT_HOST,
                port: process.env.EXTERNAL_RABBIT_PORT ? parseInt(process.env.EXTERNAL_RABBIT_PORT, 10) : undefined,
                username: process.env.EXTERNAL_RABBIT_USERNAME,
                password: process.env.EXTERNAL_RABBIT_PASSWORD,
                heartbeat: process.env.EXTERNAL_RABBIT_HEARTBEAT ? parseInt(process.env.EXTERNAL_RABBIT_HEARTBEAT, 10) : undefined,
            },
            socketOptions: {
                clientProperties: {
                    applicationName: `${serviceName} Service`,
                },
            },
            reconnectOptions: {
                reconnectEnabled: true,
            },
            listenerOptions: <ListenerOptions>{
                prefetchCount: process.env.EXTERNAL_RABBIT_QUEUE_PREFETCH_COUNT
                    ? parseInt(process.env.EXTERNAL_RABBIT_QUEUE_PREFETCH_COUNT, 10)
                    : 1,
            },
            assertExchanges: process.env.EXTERNAL_RABBIT_ASSERT_EXCHANGES === 'true',
            custom: {
                responseRoutingKeyPrefix: process.env.EXTERNAL_RABBIT_RESPONSE_ROUTING_KEY_PREFIX,
            },
        },
    },

    healthCheck: <HealthCheckConfig>{
        isEnabled: envService.getVar('METRICS_MOLECULER_PROMETHEUS_IS_ENABLED', 'boolean', true),
        port: envService.getVar('HEALTH_CHECK_IS_PORT', 'number', 3000),
    },

    metrics: <MetricsConfig>{
        moleculer: {
            prometheus: {
                isEnabled: envService.getVar('METRICS_MOLECULER_PROMETHEUS_IS_ENABLED', 'boolean', true),
                port: envService.getVar('METRICS_MOLECULER_PROMETHEUS_PORT', 'number', 3031),
                path: envService.getVar('METRICS_MOLECULER_PROMETHEUS_PATH', 'string', '/metrics'),
            },
        },
        custom: {
            disabled: envService.getVar('METRICS_CUSTOM_DISABLED', 'boolean', false),
            port: envService.getVar('METRICS_CUSTOM_PORT', 'number', 3030),
            moleculer: {
                disabled: envService.getVar('METRICS_CUSTOM_MOLECULER_DISABLED', 'boolean', false),
                port: envService.getVar('METRICS_CUSTOM_MOLECULER_PORT', 'number', 3031),
                path: envService.getVar('METRICS_CUSTOM_MOLECULER_PATH', 'string', '/metrics'),
            },
            disableDefaultMetrics: envService.getVar('METRICS_CUSTOM_DISABLE_DEFAULT_METRICS', 'boolean', false),
            defaultLabels: envService.getVar('METRICS_CUSTOM_DEFAULT_LABELS', 'object', {}),
        },
    },

    app: {
        integrationPointsTimeout: process.env.INTEGRATION_TIMEOUT_IN_MSEC
            ? parseInt(process.env.INTEGRATION_TIMEOUT_IN_MSEC, 10)
            : 10 * 1000,
        externalBusTimeout: process.env.EXTERNAL_BUS_TIMEOUT ? parseInt(process.env.EXTERNAL_BUS_TIMEOUT, 10) : 5 * 1000,
    },

    identifier: <IdentifierConfig>{
        salt: process.env.SALT,
    },

    tracing: {
        zipkin: {
            isEnabled: envService.getVar('ZIPKIN_IS_ENABLED', 'boolean'),
            baseURL: envService.getVar('ZIPKIN_URL'),
            sendIntervalSec: envService.getVar('ZIPKIN_SEND_INTERVAL_SEC', 'number'),
        },
    },

    cors: {
        allowedHeaders: [],
        credentials: false,
        exposedHeaders: [],
        maxAge: 1800,
        methods: [],
        origins: [],
    },

    grpc: {
        testServiceAddress: envService.getVar('GRPC_TEST_SERVICE_ADDRESS', 'string'),
    },
})
