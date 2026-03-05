import { EnvService } from '@diia-inhouse/env'

import { BaseConfig } from '../../src/interfaces'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const configFactory = async (_: EnvService, serviceName: string) =>
    ({
        isMoleculerEnabled: false,
        serviceName,
        depsDir: './tests/unit/dist',
        transporter: {
            type: EnvService.getVar('TRANSPORT_TYPE', 'string', 'Redis'),
            options: EnvService.getVar('TRANSPORT_OPTIONS', 'object', {}),
        },

        balancing: {
            strategy: EnvService.getVar('BALANCING_STRATEGY_NAME', 'string', 'RoundRobin'),
            strategyOptions: process.env.BALANCING_STRATEGY_OPTIONS ? JSON.parse(process.env.BALANCING_STRATEGY_OPTIONS) : {},
        },

        healthCheck: {
            isEnabled: EnvService.getVar('METRICS_MOLECULER_PROMETHEUS_IS_ENABLED', 'boolean', false),
            port: EnvService.getVar('HEALTH_CHECK_IS_PORT', 'number', 3000),
        },

        metrics: {
            moleculer: {
                prometheus: {
                    isEnabled: EnvService.getVar('METRICS_MOLECULER_PROMETHEUS_IS_ENABLED', 'boolean', false),
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
            salt: process.env.SALT || '',
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
            testServiceAddress: EnvService.getVar('GRPC_TEST_SERVICE_ADDRESS', 'string', null),
        },
    }) satisfies BaseConfig & Record<string, unknown>
