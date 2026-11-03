import { SessionType } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { GrpcServerStreamAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/chatTest'

export default class ChatTestAction extends GrpcServerStreamAction<CustomActionArguments> {
    readonly sessionType: SessionType = SessionType.None

    readonly name = 'chatTest'

    readonly validationRules: ValidationSchema<CustomActionArguments['params']> = {
        id: { type: 'string' },
        payload: { type: 'string' },
        error: { type: 'string', optional: true },
    }

    async handler(args: CustomActionArguments): Promise<ActionResult> {
        const {
            params: { id, payload },
        } = args

        return { id, payload: `echo: ${payload}` }
    }

    onConnectionOpened(): void {}

    async onConnectionClosed(): Promise<void> {}
}
