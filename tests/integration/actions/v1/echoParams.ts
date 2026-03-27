import { SessionType } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { GrpcAppAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/echoParams'

export default class EchoParamsAction implements GrpcAppAction {
    readonly sessionType: SessionType = SessionType.None

    readonly name = 'echoParams'

    readonly validationRules: ValidationSchema<CustomActionArguments['params']> = {
        name: { type: 'string' },
        nickname: { type: 'string', optional: true },
        nested: { type: 'object', optional: true },
        items: { type: 'array', optional: true },
    }

    async handler(args: CustomActionArguments): Promise<ActionResult> {
        const { params } = args

        return { paramsJson: JSON.stringify(params) }
    }
}
