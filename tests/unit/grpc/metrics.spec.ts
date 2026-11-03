import { register } from 'prom-client'

import { MetricNames } from '../../../src/interfaces/metrics.js'
import { createGrpcStreamConnectionsObserver, createGrpcStreamPendingCloseObserver, createNodeEnvObserver } from '../../../src/metrics.js'

describe('metric observers', () => {
    afterEach(() => {
        register.clear()
    })

    it.each([
        {
            name: MetricNames.GrpcStreamConnections,
            observe: (read: () => number): unknown => createGrpcStreamConnectionsObserver(read, 'test-service'),
            values: [3, 7],
            labels: { service: 'test-service' },
        },
        {
            name: MetricNames.GrpcStreamPendingClose,
            observe: (read: () => number): unknown => createGrpcStreamPendingCloseObserver(read, 'test-service'),
            values: [2, 5],
            labels: { service: 'test-service' },
        },
    ])('should report the current $name on every scrape', async ({ name, observe, values: [first, second], labels }) => {
        // Arrange
        const read = vi.fn<() => number>(() => first)

        observe(read)
        const metric = register.getSingleMetric(name)

        // Assert
        expect(read).not.toHaveBeenCalled()
        expect(await metric?.get()).toMatchObject({ values: [{ value: first, labels }] })

        // Act
        read.mockReturnValue(second)

        // Assert
        expect(await metric?.get()).toMatchObject({ values: [{ value: second, labels }] })
    })

    it('should report the node env as a single labelled series on every scrape', async () => {
        // Arrange
        const getEnv = vi.fn<() => string>(() => 'stage')

        createNodeEnvObserver(getEnv)
        const metric = register.getSingleMetric(MetricNames.NodeEnv)

        // Act
        await register.metrics()
        await register.metrics()

        // Assert
        expect(await metric?.get()).toMatchObject({ values: [{ value: 1, labels: { env: 'stage' } }] })
    })
})
