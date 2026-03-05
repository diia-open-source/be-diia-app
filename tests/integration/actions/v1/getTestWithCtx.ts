import { setTimeout } from 'node:timers/promises'

import { SessionType } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { GrpcAppAction } from '../../../../src'
import { ActionResult, Context } from '../../interfaces/actions/v1/getTestWithCtx'

export default class GetTestAction implements GrpcAppAction<Context> {
    readonly sessionType = [SessionType.User, SessionType.EResident] as const

    readonly name = 'getTestWithCtx'

    readonly validationRules: ValidationSchema<Context['params']> = {
        timeoutMs: { type: 'number' },
    }

    async handler(args: Context): Promise<ActionResult> {
        const {
            params: { timeoutMs },
        } = args

        await setTimeout(timeoutMs)

        return { status: 'ok' }
    }
}
