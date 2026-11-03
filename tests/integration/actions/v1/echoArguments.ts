import { ActionVersion, SessionType } from '@diia-inhouse/types'

import { AppAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/echoArguments'

export default class EchoArgumentsAction implements AppAction {
    readonly sessionType: SessionType = SessionType.None

    readonly actionVersion = ActionVersion.V1

    readonly name = 'echoArguments'

    async handler(args: CustomActionArguments): Promise<ActionResult> {
        const { session, headers } = args

        return { session, headers }
    }
}
