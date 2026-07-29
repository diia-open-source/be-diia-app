import { MetricOptions, Observer } from '@diia-inhouse/diia-metrics'

import {
    grpcStreamMetricAllowedFields,
    GrpcStreamMetricLabelsMap,
    MetricDescriptions,
    MetricNames,
    nodeEnvAllowedFields,
    NodeEnvLabelsMap,
} from './interfaces/metrics.js'

export function createNodeEnvObserver(getEnv: () => string): Observer<NodeEnvLabelsMap> {
    return new Observer<NodeEnvLabelsMap>(MetricNames.NodeEnv, nodeEnvAllowedFields, MetricDescriptions.NodeEnv, {
        onCollect: (): ReturnType<Required<MetricOptions<NodeEnvLabelsMap>>['onCollect']> => ({
            labels: { env: getEnv() },
            value: 1,
        }),
    })
}

export function createGrpcStreamConnectionsObserver(onCollect: () => number, serviceName: string): Observer<GrpcStreamMetricLabelsMap> {
    return new Observer<GrpcStreamMetricLabelsMap>(
        MetricNames.GrpcStreamConnections,
        grpcStreamMetricAllowedFields,
        MetricDescriptions.GrpcStreamConnections,
        {
            onCollect: () => ({
                labels: { service: serviceName },
                value: onCollect(),
            }),
        },
    )
}

export function createGrpcStreamPendingCloseObserver(onCollect: () => number, serviceName: string): Observer<GrpcStreamMetricLabelsMap> {
    return new Observer<GrpcStreamMetricLabelsMap>(
        MetricNames.GrpcStreamPendingClose,
        grpcStreamMetricAllowedFields,
        MetricDescriptions.GrpcStreamPendingClose,
        {
            onCollect: () => ({
                labels: { service: serviceName },
                value: onCollect(),
            }),
        },
    )
}
