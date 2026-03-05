import type { AuthConfig, IdentifierConfig } from '@diia-inhouse/crypto'
import type { AppDbConfig, DatabaseAdapterType, PostgresDbConfig } from '@diia-inhouse/db'
import type { MetricsConfig as CustomMetricsConfig } from '@diia-inhouse/diia-metrics'
import type { QueueConnectionConfig } from '@diia-inhouse/diia-queue'
import type { FeatureConfig } from '@diia-inhouse/features'
import type { HealthCheckConfig } from '@diia-inhouse/healthcheck'
import type { RedisConfig } from '@diia-inhouse/redis'
import type { GenericObject, HttpMethod } from '@diia-inhouse/types'

import { GrpcServerConfig } from './grpc'

export type CorsConfig = {
    // Configures the Access-Control-Allow-Origin CORS header.
    origins: string[]
    // Configures the Access-Control-Allow-Methods CORS header.
    methods: HttpMethod[]
    // Configures the Access-Control-Allow-Headers CORS header.
    allowedHeaders: string[]
    // Configures the Access-Control-Expose-Headers CORS header.
    exposedHeaders: string[]
    // Configures the Access-Control-Allow-Credentials CORS header.
    credentials: boolean
    // Configures the Access-Control-Max-Age CORS header.
    maxAge: number
}

export interface TransporterConfig {
    type: string
    options: Record<string, unknown>
}

export interface BalancingStrategy {
    strategy: string
    strategyOptions: GenericObject
}

export interface TracingConfig {
    zipkin: {
        isEnabled: boolean
        baseURL: string
        sendIntervalSec: number
    }
}

export interface MetricsConfig {
    moleculer?: {
        prometheus: {
            isEnabled: boolean
            port?: number
            path: string
        }
    }
    custom?: CustomMetricsConfig
}

export interface BaseConfig {
    listenTerminationSignals?: boolean
    depsDir?: string
    transporter?: TransporterConfig
    app?: {
        [key: string]: unknown
        externalBusTimeout?: number
    }
    cors?: CorsConfig
    balancing?: BalancingStrategy
    tracing?: TracingConfig
    metrics?: MetricsConfig
    isMoleculerEnabled?: boolean
    store?: RedisConfig
    /** @deprecated use store instead */
    redis?: RedisConfig
    rabbit?: QueueConnectionConfig
    healthCheck?: HealthCheckConfig
    databaseAdapter?: DatabaseAdapterType
    db?: AppDbConfig
    postgres?: PostgresDbConfig
    auth?: AuthConfig
    identifier?: IdentifierConfig
    grpcServer?: GrpcServerConfig
    featureFlags?: FeatureConfig
}
