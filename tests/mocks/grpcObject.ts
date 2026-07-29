import { GrpcObject, Metadata, ServiceClientConstructor, ServiceDefinition } from '@grpc/grpc-js'

import { ApiError } from '@diia-inhouse/errors'
import {
    ActionVersion,
    AppUserActionHeaders,
    GenericObject,
    grpcMetadataKeys,
    HttpStatusCode,
    ServiceActionArguments,
    SessionType,
} from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { AppAction, GrpcServerStreamAction } from '../../src'

interface GrpcActionArguments extends ServiceActionArguments<AppUserActionHeaders> {
    params: { param: string }
}

interface GrpcActionErrorArguments extends ServiceActionArguments<AppUserActionHeaders> {
    params: { param: string; processCode?: number }
}

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

export const grpcObjectWithActionError: GrpcObject = {
    'service-with-action-error': {
        service: {
            'action-error': {
                originalName: 'action-error',
                path: '/action-error',
            },
        } as unknown as ServiceDefinition,
        serviceName: 'action-error',
    } as ServiceClientConstructor,
}

export const grpcObjectActionRedlock: GrpcObject = {
    'service-with-action-redlock': {
        service: {
            'action-redlock': {
                originalName: 'action-redlock',
                path: '/action-redlock',
            },
        } as unknown as ServiceDefinition,
        serviceName: 'action-redlock',
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

export class GrpcAction implements AppAction {
    readonly name: string = 'action'

    readonly actionVersion: ActionVersion = ActionVersion.V1

    readonly validationRules: ValidationSchema = {
        param: { type: 'string' },
    }

    readonly sessionType: SessionType = SessionType.User

    constructor(private readonly onConnectionClosedPromise?: Promise<void>) {}

    async handler(args: GrpcActionArguments): Promise<string> {
        return args.params.param
    }

    async onConnectionClosed(): Promise<void> {
        if (this.onConnectionClosedPromise) {
            await this.onConnectionClosedPromise
        }
    }
}

export class GrpcActionError implements AppAction {
    readonly name: string = 'action-error'

    readonly actionVersion: ActionVersion = ActionVersion.V1

    readonly validationRules: ValidationSchema = {
        param: { type: 'string', enum: Object.values(HttpStatusCode).map(String) },
        processCode: { type: 'number', optional: true },
    }

    readonly sessionType: SessionType = SessionType.User

    async handler(args: GrpcActionErrorArguments): Promise<string> {
        throw new ApiError('Mocked error', Number.parseInt(args.params.param), {}, args.params.processCode)
    }
}

export class GrpcActionRedlock implements AppAction {
    readonly name: string = 'action-redlock'

    readonly actionVersion: ActionVersion = ActionVersion.V1

    readonly sessionType: SessionType = SessionType.User

    getLockResource(args: ServiceActionArguments<AppUserActionHeaders>): string {
        const {
            headers: { mobileUid },
        } = args

        return `action-redlock-${mobileUid}`
    }

    async handler(): Promise<boolean> {
        return true
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
