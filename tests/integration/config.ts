import { IdentifierConfig } from '@diia-inhouse/crypto'
import { EnvService } from '@diia-inhouse/env'
import { HealthCheckConfig } from '@diia-inhouse/healthcheck'
import { RedisConfig } from '@diia-inhouse/redis'

import { BalancingStrategy, BaseConfig, MetricsConfig, TransporterConfig } from '../../src/interfaces'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const configFactory = async (envService: EnvService, serviceName: string) =>
    ({
        isMoleculerEnabled: true,
        serviceName,
        depsDir: '../dist/tests/integration',

        transporter: <TransporterConfig>{
            type: envService.getVar('TRANSPORT_TYPE', 'string'),
            options: envService.getVar('TRANSPORT_OPTIONS', 'object', {}),
        },

        balancing: <BalancingStrategy>{
            strategy: process.env.BALANCING_STRATEGY_NAME,
            strategyOptions: process.env.BALANCING_STRATEGY_OPTIONS ? JSON.parse(process.env.BALANCING_STRATEGY_OPTIONS) : {},
        },

        healthCheck: <HealthCheckConfig>{
            isEnabled: envService.getVar('METRICS_MOLECULER_PROMETHEUS_IS_ENABLED', 'boolean', false),
            port: envService.getVar('HEALTH_CHECK_IS_PORT', 'number', 3000),
        },

        store: <RedisConfig>{
            readWrite: envService.getVar('STORE_READ_WRITE_OPTIONS', 'object'),

            readOnly: envService.getVar('STORE_READ_ONLY_OPTIONS', 'object'),
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
                ? Number.parseInt(process.env.INTEGRATION_TIMEOUT_IN_MSEC, 10)
                : 10 * 1000,
            externalBusTimeout: process.env.EXTERNAL_BUS_TIMEOUT ? Number.parseInt(process.env.EXTERNAL_BUS_TIMEOUT, 10) : 5 * 1000,
        },

        identifier: <IdentifierConfig>{
            salt: process.env.SALT,
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
            testServiceAddress: envService.getVar('GRPC_TEST_SERVICE_ADDRESS', 'string', null),
        },

        grpcServer: {
            isEnabled: envService.getVar('GRPC_SERVER_ENABLED', 'boolean', false),
            port: envService.getVar('GRPC_SERVER_PORT', 'number', 5000),
            services: envService.getVar('GRPC_SERVICES', 'object'),
            isReflectionEnabled: envService.getVar('GRPC_REFLECTION_ENABLED', 'boolean', false),
            maxReceiveMessageLength: envService.getVar('GRPC_SERVER_MAX_RECEIVE_MESSAGE_LENGTH', 'number', 1024 * 1024 * 4),
        },
    }) satisfies BaseConfig & Record<string, unknown>
