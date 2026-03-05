import { Metadata } from '@grpc/grpc-js'

import { Logger } from '@diia-inhouse/types'

import { DynamicGrpcClient, DynamicGrpcClientOptions } from './dynamicClient'

export interface GrpcExecuteParams {
    serviceId: string
    grpcMethod: string
    body: object
    metadata?: Record<string, string>
}

export interface GrpcExecuteResult {
    success: boolean
    data?: object
    error?: {
        message: string
        metadata?: Record<string, unknown>
    }
}

export interface GrpcExecutorConfig {
    getServiceAddress(serviceId: string): string
    createBaseMetadata(serviceId: string): Record<string, string>
}

export class GrpcExecutor {
    private readonly dynamicClient: DynamicGrpcClient

    constructor(
        private readonly config: GrpcExecutorConfig,
        private readonly logger: Logger,
        clientOptions?: DynamicGrpcClientOptions,
    ) {
        this.dynamicClient = new DynamicGrpcClient(logger, clientOptions)
    }

    async execute(params: GrpcExecuteParams): Promise<GrpcExecuteResult> {
        const { serviceId, grpcMethod, body, metadata: customMetadata } = params

        try {
            const address = this.config.getServiceAddress(serviceId)
            const metadata = this.createMetadata(serviceId, customMetadata)

            this.logger.debug('Executing gRPC request', { serviceId, grpcMethod, address, customMetadata })

            const result = await this.dynamicClient.call({
                address,
                method: grpcMethod,
                body,
                metadata,
            })

            return { success: true, data: result }
        } catch (err) {
            const error = err as Error & {
                metadata?: Metadata
            }

            this.logger.error('gRPC execution failed', { err, serviceId, grpcMethod })

            const errorMetadata: Record<string, unknown> = {}
            if (error.metadata) {
                const metadataMap = error.metadata.getMap()
                for (const [key, value] of Object.entries(metadataMap)) {
                    if (key === 'original-error') {
                        try {
                            const decoded = decodeURIComponent(String(value))

                            errorMetadata[key] = JSON.parse(decoded)
                        } catch {
                            errorMetadata[key] = String(value)
                        }
                    } else {
                        errorMetadata[key] = String(value)
                    }
                }
            }

            return {
                success: false,
                error: {
                    message: error.message,
                    metadata: Object.keys(errorMetadata).length > 0 ? errorMetadata : undefined,
                },
            }
        }
    }

    close(): void {
        this.dynamicClient.close()
    }

    private createMetadata(serviceId: string, customMetadata?: Record<string, string>): Metadata {
        const metadata = new Metadata()

        const baseMetadata = this.config.createBaseMetadata(serviceId)
        for (const [key, value] of Object.entries(baseMetadata)) {
            if (value) {
                metadata.set(key, value)
            }
        }

        if (customMetadata) {
            for (const [key, value] of Object.entries(customMetadata)) {
                if (value) {
                    metadata.set(key, value)
                }
            }
        }

        return metadata
    }
}
