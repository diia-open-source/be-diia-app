import { setTimeout } from 'node:timers/promises'

import { ApiError } from '@diia-inhouse/errors'
import { ActHeaders, GenericObject, HttpStatusCode, SessionType } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { GrpcServerStreamAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/subscribeTest'

export const subscribeTestProcessCode = 1013

export default class SubscribeTestAction extends GrpcServerStreamAction<CustomActionArguments> {
    readonly sessionType: SessionType = SessionType.None

    readonly name: string = 'subscribeTest'

    readonly validationRules: ValidationSchema<CustomActionArguments['params']> = {
        id: { type: 'string' },
        mode: { type: 'string', optional: true },
    }

    readonly openedConnections: ActHeaders[] = []

    readonly closedConnections: { headers: ActHeaders; request: GenericObject; closedAt: number }[] = []

    async handler(args: CustomActionArguments): Promise<ActionResult> {
        const {
            params: { id, mode },
        } = args

        if (mode === 'returnError') {
            return { id, payload: '', error: 'handler failed' }
        }

        if (mode === 'throw') {
            throw new ApiError('subscription forbidden', HttpStatusCode.FORBIDDEN, {}, subscribeTestProcessCode)
        }

        return { id, payload: 'subscribed', error: undefined }
    }

    publish(mobileUid: string, event: ActionResult): void {
        this.publishToChannel(mobileUid, event)
    }

    onConnectionOpened(headers: ActHeaders): void {
        this.openedConnections.push(headers)
    }

    async onConnectionClosed(headers: ActHeaders, request: GenericObject): Promise<void> {
        if (request.mode === 'slowClose') {
            await setTimeout(300)
        }

        this.closedConnections.push({ headers, request, closedAt: Date.now() })

        if (request.mode === 'throwOnClose') {
            throw new Error('close failed')
        }
    }
}
