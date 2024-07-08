import { setTimeout } from 'node:timers/promises'

import { SessionType } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { GrpcAppAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/getTest'

export default class GetTestAction implements GrpcAppAction {
    readonly sessionType: SessionType = SessionType.User

    readonly name = 'getTest'

    readonly validationRules: ValidationSchema<CustomActionArguments['params']> = {
        timeoutMs: { type: 'number' },
    }

    async handler(args: CustomActionArguments): Promise<ActionResult> {
        const {
            params: { timeoutMs },
        } = args

        await setTimeout(timeoutMs)

        return { status: 'ok' }
    }
}
