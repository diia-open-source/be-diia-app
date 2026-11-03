import { ActionVersion, SessionType } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { GrpcAppAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/getVersioned'

export default class GetVersionedAction implements GrpcAppAction {
    readonly sessionType: SessionType = SessionType.None

    readonly actionVersion = ActionVersion.V1

    readonly name = 'getVersioned'

    readonly validationRules: ValidationSchema<CustomActionArguments['params']> = {
        timeoutMs: { type: 'number' },
    }

    async handler(): Promise<ActionResult> {
        return { version: this.actionVersion }
    }
}
