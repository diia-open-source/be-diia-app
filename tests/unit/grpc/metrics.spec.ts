import { register } from 'prom-client'

import { MetricOptions, Observer } from '@diia-inhouse/diia-metrics'
import { Env } from '@diia-inhouse/env'

import { MetricDescriptions, MetricNames, NodeEnvLabelsMap, nodeEnvAllowedFields } from '../../../src/interfaces/metrics.js'
import { createGrpcStreamConnectionsObserver, createGrpcStreamPendingCloseObserver } from '../../../src/metrics.js'

describe('grpc stream metrics', () => {
    afterEach(() => {
        register.clear()
    })

    it('should call onCollect on each scrape, not at registration time', async () => {
        // Arrange
        const serviceName = 'test-service'
        const activeConnectionsCount = 3
        const getActiveConnections = vi.fn<() => number>(() => activeConnectionsCount)

        createGrpcStreamConnectionsObserver(getActiveConnections, serviceName)

        expect(getActiveConnections).not.toHaveBeenCalled()

        const metric = register.getSingleMetric(MetricNames.GrpcStreamConnections)

        // Act
        await register.metrics()

        // Assert
        expect(getActiveConnections).toHaveBeenCalledTimes(1)
        expect(await metric?.get()).toMatchObject({
            values: [expect.objectContaining({ value: activeConnectionsCount, labels: { service: serviceName } })],
        })

        const newActiveConnectionsCount = 7

        getActiveConnections.mockClear()
        getActiveConnections.mockReturnValue(newActiveConnectionsCount)

        // Act
        await register.metrics()

        // Assert
        expect(getActiveConnections).toHaveBeenCalledTimes(1)
        expect(await metric?.get()).toMatchObject({
            values: [expect.objectContaining({ value: newActiveConnectionsCount, labels: { service: serviceName } })],
        })
    })

    it('should expose pending close handlers count on collect', async () => {
        // Arrange
        const serviceName = 'test-service'
        const pendingStreamCloseCount = 2

        createGrpcStreamPendingCloseObserver(() => pendingStreamCloseCount, serviceName)

        const metric = register.getSingleMetric(MetricNames.GrpcStreamPendingClose)

        // Act
        await register.metrics()

        // Assert
        expect(metric).toBeDefined()
        expect(await metric?.get()).toMatchObject({
            values: [expect.objectContaining({ value: pendingStreamCloseCount, labels: { service: serviceName } })],
        })
    })

    it('should use the same onCollect contract as Application diia_node_env observer', async () => {
        // Arrange
        const serviceName = 'test-service'
        const getEnv = vi.fn<() => string>(() => Env.Stage)

        const nodeEnvObserver = new Observer<NodeEnvLabelsMap>(MetricNames.NodeEnv, nodeEnvAllowedFields, MetricDescriptions.NodeEnv, {
            onCollect: (): ReturnType<Required<MetricOptions<NodeEnvLabelsMap>>['onCollect']> => ({
                labels: { env: getEnv() },
                value: 1,
            }),
        })

        const streamConnectionsCount = 4
        const getStreamConnections = vi.fn<() => number>(() => streamConnectionsCount)

        createGrpcStreamConnectionsObserver(getStreamConnections, serviceName)

        // Act
        await register.metrics()

        // Assert
        expect(nodeEnvObserver).toBeDefined()

        const nodeEnvMetric = register.getSingleMetric(MetricNames.NodeEnv)
        const streamConnectionsMetric = register.getSingleMetric(MetricNames.GrpcStreamConnections)

        expect(getEnv).toHaveBeenCalledTimes(1)
        expect(getStreamConnections).toHaveBeenCalledTimes(1)

        expect(await nodeEnvMetric?.get()).toMatchObject({
            values: [expect.objectContaining({ labels: { env: Env.Stage }, value: 1 })],
        })
        expect(await streamConnectionsMetric?.get()).toMatchObject({
            values: [expect.objectContaining({ labels: { service: serviceName }, value: streamConnectionsCount })],
        })

        const newStreamConnectionsCount = 9

        getStreamConnections.mockClear()
        getStreamConnections.mockReturnValue(newStreamConnectionsCount)

        // Act
        await register.metrics()

        // Assert
        expect(getStreamConnections).toHaveBeenCalledTimes(1)
        expect(await streamConnectionsMetric?.get()).toMatchObject({
            values: [expect.objectContaining({ value: newStreamConnectionsCount })],
        })
    })
})
