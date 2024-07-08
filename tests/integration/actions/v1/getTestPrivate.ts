import { SessionType } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { GrpcAppAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/getTestPrivate'

export default class GetTestPrivateAction implements GrpcAppAction {
    readonly sessionType: SessionType = SessionType.User

    readonly name = 'getTestPrivate'

    readonly validationRules: ValidationSchema<CustomActionArguments['params']> = {
        timeoutMs: { type: 'number' },
    }

    async handler(): Promise<ActionResult> {
        return { status: 'ok' }
    }
}
