import { IdentifierConfig } from '@diia-inhouse/crypto'
import { EnvService } from '@diia-inhouse/env'
import { HealthCheckConfig } from '@diia-inhouse/healthcheck'
import { RedisConfig } from '@diia-inhouse/redis'
import { DurationMs } from '@diia-inhouse/types'

import { BalancingStrategy, BaseConfig, TransporterConfig } from '../../src/interfaces'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const configFactory = async (_: EnvService, serviceName: string) =>
    ({
        isMoleculerEnabled: true,
        serviceName,

        transporter: {
            type: EnvService.getVar('TRANSPORT_TYPE', 'string'),
            options: EnvService.getVar('TRANSPORT_OPTIONS', 'object', {}),
        } as TransporterConfig,

        balancing: {
            strategy: process.env.BALANCING_STRATEGY_NAME,
            strategyOptions: process.env.BALANCING_STRATEGY_OPTIONS ? JSON.parse(process.env.BALANCING_STRATEGY_OPTIONS) : {},
        } as BalancingStrategy,

        healthCheck: {
            isEnabled: EnvService.getVar('METRICS_MOLECULER_PROMETHEUS_IS_ENABLED', 'boolean', false),
            port: EnvService.getVar('HEALTH_CHECK_IS_PORT', 'number', 3000),
        } as HealthCheckConfig,

        store: {
            readWrite: EnvService.getVar('STORE_READ_WRITE_OPTIONS', 'object'),

            readOnly: EnvService.getVar('STORE_READ_ONLY_OPTIONS', 'object'),
        } as RedisConfig,

        metrics: {
            moleculer: {
                prometheus: {
                    isEnabled: EnvService.getVar('METRICS_MOLECULER_PROMETHEUS_IS_ENABLED', 'boolean', true),
                    port: EnvService.getVar('METRICS_MOLECULER_PROMETHEUS_PORT', 'number', 3031),
                    path: EnvService.getVar('METRICS_MOLECULER_PROMETHEUS_PATH', 'string', '/metrics'),
                },
            },
            custom: {
                disabled: EnvService.getVar('METRICS_CUSTOM_DISABLED', 'boolean', false),
                port: EnvService.getVar('METRICS_CUSTOM_PORT', 'number', 3030),
                disableDefaultMetrics: EnvService.getVar('METRICS_CUSTOM_DISABLE_DEFAULT_METRICS', 'boolean', false),
                defaultLabels: EnvService.getVar('METRICS_CUSTOM_DEFAULT_LABELS', 'object', {}),
                pushGateway: {
                    isEnabled: EnvService.getVar('METRICS_CUSTOM_PUSH_GATEWAY_IS_ENABLED', 'boolean', false),
                    url: EnvService.getVar('METRICS_CUSTOM_PUSH_GATEWAY_URL', 'string', 'http://localhost:3030'),
                },
            },
        },

        app: {
            integrationPointsTimeout: process.env.INTEGRATION_TIMEOUT_IN_MSEC
                ? Number.parseInt(process.env.INTEGRATION_TIMEOUT_IN_MSEC, 10)
                : 10 * 1000,
            externalBusTimeout: process.env.EXTERNAL_BUS_TIMEOUT ? Number.parseInt(process.env.EXTERNAL_BUS_TIMEOUT, 10) : 5 * 1000,
        },

        identifier: {
            salt: process.env.SALT,
        } as IdentifierConfig,

        cors: {
            allowedHeaders: [],
            credentials: false,
            exposedHeaders: [],
            maxAge: 1800,
            methods: [],
            origins: [],
        },

        grpcClient: {
            defaultDeadlineMs: EnvService.getVar('GRPC_CLIENT_DEFAULT_DEADLINE_MS', 'number', Number(DurationMs.Second)),
        },

        grpcServer: {
            isEnabled: EnvService.getVar('GRPC_SERVER_ENABLED', 'boolean', false),
            port: EnvService.getVar('GRPC_SERVER_PORT', 'number', 5000),
            services: EnvService.getVar('GRPC_SERVICES', 'object'),
            isReflectionEnabled: EnvService.getVar('GRPC_REFLECTION_ENABLED', 'boolean', false),
            maxReceiveMessageLength: EnvService.getVar('GRPC_SERVER_MAX_RECEIVE_MESSAGE_LENGTH', 'number', 1024 * 1024 * 4),
        },
    }) satisfies BaseConfig & Record<string, unknown>
