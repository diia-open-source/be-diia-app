import { MetricsService } from '@diia-inhouse/diia-metrics'

export interface AppDeps {
    metrics: MetricsService
    test?: string
}
