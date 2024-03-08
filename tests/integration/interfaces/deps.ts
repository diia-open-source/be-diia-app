import { CryptoDeps } from '@diia-inhouse/crypto'
import { DatabaseService } from '@diia-inhouse/db'
import { QueueDeps } from '@diia-inhouse/diia-queue'
import { HealthCheck } from '@diia-inhouse/healthcheck'
import { RedisDeps } from '@diia-inhouse/redis'
import TestKit from '@diia-inhouse/test'

import { AppConfig } from './config'

export type AppDeps = {
    config: AppConfig
    healthCheck: HealthCheck
    database: DatabaseService
    testKit: TestKit
} & QueueDeps &
    RedisDeps &
    CryptoDeps
