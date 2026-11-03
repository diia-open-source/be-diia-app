import { SessionType } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { GrpcAppAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/echoTimestamp'

export default class EchoTimestampAction implements GrpcAppAction {
    readonly sessionType: SessionType = SessionType.None

    readonly name = 'echoTimestamp'

    readonly validationRules: ValidationSchema<CustomActionArguments['params']> = {
        at: { type: 'date', optional: true },
        shape: { type: 'string', enum: ['date', 'seconds'] },
    }

    async handler(args: CustomActionArguments): Promise<ActionResult> {
        const {
            params: { at, shape },
        } = args
        const receivedAs = at instanceof Date ? 'Date' : typeof at

        switch (shape) {
            case 'seconds': {
                return { at: at && { seconds: Math.floor(at.getTime() / 1000), nanos: (at.getTime() % 1000) * 1000000 }, receivedAs }
            }
            default: {
                return { at, receivedAs }
            }
        }
    }
}
