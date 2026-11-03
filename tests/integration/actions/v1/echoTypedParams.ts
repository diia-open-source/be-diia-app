import { SessionType } from '@diia-inhouse/types'

import { GrpcAppAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/echoTypedParams'

export default class EchoTypedParamsAction implements GrpcAppAction {
    readonly sessionType: SessionType = SessionType.None

    readonly name = 'echoTypedParams'

    async handler(args: CustomActionArguments): Promise<ActionResult> {
        return args.params
    }
}
