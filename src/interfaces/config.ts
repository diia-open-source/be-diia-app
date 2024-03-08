import { MetricsConfig as CustomMetricsConfig } from '@diia-inhouse/diia-metrics'
import { GenericObject, HttpMethod } from '@diia-inhouse/types'

export interface CorsConfig {
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
    transporter?: TransporterConfig
    app?: {
        externalBusTimeout?: number
        [key: string]: unknown
    }
    cors?: CorsConfig
    balancing?: BalancingStrategy
    tracing?: TracingConfig
    metrics?: MetricsConfig
    isMoleculerEnabled?: boolean
}
