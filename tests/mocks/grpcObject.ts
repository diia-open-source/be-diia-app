import { GrpcObject, Metadata, ServiceClientConstructor, ServiceDefinition } from '@grpc/grpc-js'

import { ActionVersion, GenericObject, grpcMetadataKeys, SessionType } from '@diia-inhouse/types'

import { GrpcServerStreamAction } from '../../src'

export const grpcObjectWithStreamAction: GrpcObject = {
    'service-with-stream-action': {
        service: {
            action: {
                originalName: 'action',
                path: '/action',
                responseStream: true,
                requestStream: false,
            },
        } as unknown as ServiceDefinition,
        serviceName: 'action',
    } as ServiceClientConstructor,
}

export const grpcObjectWithAction: GrpcObject = {
    'service-with-action': {
        service: {
            action: {
                originalName: 'action',
                path: '/action',
            },
        } as unknown as ServiceDefinition,
        serviceName: 'action',
    } as ServiceClientConstructor,
}

export class GrpcStreamChannelAction extends GrpcServerStreamAction {
    readonly name: string = 'action'

    readonly actionVersion: ActionVersion = ActionVersion.V1

    readonly sessionType: SessionType = SessionType.User

    constructor(private readonly onConnectionClosedPromise?: Promise<void>) {
        super()
    }

    async handler(): Promise<void> {}

    async onConnectionClosed(): Promise<void> {
        if (this.onConnectionClosedPromise) {
            await this.onConnectionClosedPromise
        }
    }

    onConnectionOpened(): void {}

    publishTestMessage(mobileUid: string, data: GenericObject): void {
        this.publishToChannel(mobileUid, data)
    }
}

export type StreamEventHandler = (...args: unknown[]) => unknown

export interface MockGrpcStreamInput {
    metadata: Metadata
    request?: GenericObject
    addListener: ReturnType<typeof vi.fn<(event: string, handler: StreamEventHandler) => unknown>>
    prependListener: ReturnType<typeof vi.fn<(event: string, handler: StreamEventHandler) => unknown>>
    write: ReturnType<typeof vi.fn<() => unknown>>
    end: ReturnType<typeof vi.fn<() => unknown>>
    emit: ReturnType<typeof vi.fn<() => unknown>>
    destroy: ReturnType<typeof vi.fn<() => unknown>>
}

export interface CreateStreamInputResult {
    input: MockGrpcStreamInput
    listeners: Map<string, StreamEventHandler>
}

export function createStreamInput(mobileUid?: string): CreateStreamInputResult {
    const listeners = new Map<string, StreamEventHandler>()
    const metadata = new Metadata()

    if (mobileUid) {
        metadata.set(grpcMetadataKeys.MOBILE_UID, mobileUid)
    }

    const input: MockGrpcStreamInput = {
        metadata,
        request: undefined,
        addListener: vi.fn<(event: string, handler: StreamEventHandler) => unknown>(
            (event: string, handler: StreamEventHandler): unknown => {
                listeners.set(event, handler)

                return input
            },
        ),
        prependListener: vi.fn<(event: string, handler: StreamEventHandler) => unknown>(
            (event: string, handler: StreamEventHandler): unknown => {
                listeners.set(event, handler)

                return input
            },
        ),
        write: vi.fn<() => unknown>(),
        end: vi.fn<() => unknown>(),
        emit: vi.fn<() => unknown>(),
        destroy: vi.fn<() => unknown>(),
    }

    return { input, listeners }
}
