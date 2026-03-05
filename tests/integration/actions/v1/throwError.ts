import { ApiError, ErrorData, ErrorType } from '@diia-inhouse/errors'
import { SessionType } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { GrpcAppAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/throwError'

export default class ThrowErrorAction implements GrpcAppAction {
    readonly sessionType: SessionType = SessionType.User

    readonly name = 'throwError'

    readonly validationRules: ValidationSchema<CustomActionArguments['params']> = {
        httpStatus: { type: 'number' },
        processCode: { type: 'number', optional: true },
        data: { type: 'object', optional: true },
        type: { type: 'string', optional: true },
    }

    async handler(args: CustomActionArguments): Promise<ActionResult> {
        const {
            params: { httpStatus, processCode, data, type },
        } = args

        throw new ApiError('error message', httpStatus, data as unknown as ErrorData, processCode, type as ErrorType)
    }
}
