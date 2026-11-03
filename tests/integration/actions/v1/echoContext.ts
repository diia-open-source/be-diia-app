import { SessionType } from '@diia-inhouse/types'

import { GrpcAppAction } from '../../../../src'
import { ActionResult, CustomActionArguments } from '../../interfaces/actions/v1/echoContext'

export default class EchoContextAction implements GrpcAppAction {
    readonly sessionType: SessionType = SessionType.None

    readonly name = 'echoContext'

    async handler(args: CustomActionArguments): Promise<ActionResult> {
        const { headers, session } = args

        return { headersJson: JSON.stringify(headers), sessionJson: JSON.stringify(session) }
    }
}
