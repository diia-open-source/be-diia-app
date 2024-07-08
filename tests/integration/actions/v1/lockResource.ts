import { SessionType } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { GrpcAppAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/lockResource'

export default class LockResourceAction implements GrpcAppAction {
    readonly sessionType: SessionType = SessionType.User

    readonly name = 'lockResource'

    readonly validationRules: ValidationSchema<CustomActionArguments['params']> = {
        id: { type: 'string' },
    }

    getLockResource(args: CustomActionArguments): string {
        return args.params.id
    }

    async handler(): Promise<ActionResult> {
        return { status: 'ok' }
    }
}
