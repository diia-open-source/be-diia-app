import { MethodDefinition } from '@grpc/grpc-js'

import { BadRequestError } from '@diia-inhouse/errors'
import { ActionContext, ActionVersion, BaseSession, GenericObject } from '@diia-inhouse/types'
import { ActHeaders } from '@diia-inhouse/types/dist/types/common'
import { ValidationSchema } from '@diia-inhouse/validators'

import { ErrorCode } from './errorCode'
import { DeviceMultipleConnectionPolicy, StreamKey } from './grpc'

export interface AppAction<T extends ActionContext<Record<never, never>, BaseSession> = ActionContext<Record<never, never>, BaseSession>> {
    sessionType: T['session']['sessionType'] | readonly T['session']['sessionType'][]
    /** @deprecated separate action with another name that explicitly contains the version should be created: getToken -> getTokenV3 */
    actionVersion?: ActionVersion
    name: string
    validationRules?: ValidationSchema

    /** @info use only for development! */
    __actionResponse?: GenericObject

    tryLockTimeout?: number
    getLockResource?(args: T): string
    getServiceCode?(args: T): string
    handler(args: T): unknown
}

/**
 * marker interface indicates that action supports communication via grpc transport
 */
export interface GrpcAppAction<
    T extends ActionContext<Record<never, never>, BaseSession> = ActionContext<Record<never, never>, BaseSession>,
> extends AppAction<T> {
    grpcMethod?: MethodDefinition<unknown, unknown>
}

export interface GrpcStreamAction extends GrpcAppAction {
    onConnectionClosed(metadata: ActHeaders, request: GenericObject): void

    onConnectionOpened(metadata: ActHeaders, request: GenericObject): void
}

type SubscriptionHandler = (data: GenericObject) => void

export interface Subscription {
    streamId: string
    handler: SubscriptionHandler
}

export abstract class GrpcServerStreamAction<
    T extends ActionContext<Record<never, never>, BaseSession> = ActionContext<Record<never, never>, BaseSession>,
> implements GrpcStreamAction {
    protected deviceMultipleConnectionPolicy: DeviceMultipleConnectionPolicy =
        DeviceMultipleConnectionPolicy.FORBID_CLOSE_PREVIOUS_CONNECTION

    private deviceSubscriptions = new Map<string, Subscription[]>()

    abstract name: string

    abstract sessionType: T['session']['sessionType'] | readonly T['session']['sessionType'][]

    subscribeChannel(streamKey: StreamKey, handler: SubscriptionHandler): void | never {
        const { mobileUid, streamId } = streamKey
        const subscriptions = this.deviceSubscriptions.get(mobileUid) || []

        switch (this.deviceMultipleConnectionPolicy) {
            case DeviceMultipleConnectionPolicy.FORBID_REJECT_NEW_CONNECTION: {
                if (subscriptions.length > 0) {
                    throw new Error(`Unable to open new connection for ${mobileUid}, please close previous connection`)
                }

                break
            }
            case DeviceMultipleConnectionPolicy.FORBID_CLOSE_PREVIOUS_CONNECTION: {
                if (subscriptions.length > 0) {
                    throw new BadRequestError(
                        'Unable to open new connection as existed conne',
                        { subscriptions: subscriptions.map((sub) => sub.streamId) },
                        ErrorCode.SubscriptionsExists,
                    )
                }

                break
            }
            case DeviceMultipleConnectionPolicy.ALLOW_MULTIPLE_CONNECTIONS: {
                break
            }
            default: {
                const unhandledPolicy: never = this.deviceMultipleConnectionPolicy

                throw new TypeError(`Unhandled deviceMultipleConnectionPolicy: ${unhandledPolicy}`)
            }
        }

        subscriptions.push({ handler, streamId })

        this.deviceSubscriptions.set(mobileUid, subscriptions)
    }

    unsubscribeChannel(streamKey: StreamKey): void {
        const { mobileUid, streamId } = streamKey

        const subscriptions = this.deviceSubscriptions.get(mobileUid)

        if (subscriptions) {
            const indexOfStreamToRemove = subscriptions.findIndex((sub) => sub.streamId === streamId)
            if (indexOfStreamToRemove !== -1) {
                subscriptions.splice(indexOfStreamToRemove, 1)
                this.deviceSubscriptions.set(mobileUid, subscriptions)
            }
        }
    }

    protected publishToChannel(mobileUid: string, data: GenericObject): void {
        const subscriptions = this.deviceSubscriptions.get(mobileUid)

        if (subscriptions) {
            for (const subscription of subscriptions) {
                subscription.handler(data)
            }
        }
    }

    protected broadcast(data: GenericObject): void {
        for (const [, subscriptions] of this.deviceSubscriptions) {
            for (const subscription of subscriptions) {
                subscription.handler(data)
            }
        }
    }

    abstract handler(args: T): unknown

    abstract onConnectionClosed(metadata: ActHeaders, request: GenericObject): void

    abstract onConnectionOpened(metadata: ActHeaders, request: GenericObject): void
}
