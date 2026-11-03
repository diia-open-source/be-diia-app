import { ServiceActionArguments } from '@diia-inhouse/types'

import { EchoTimestampReq } from '../../../generated/test-service'

export interface CustomActionArguments extends ServiceActionArguments {
    params: EchoTimestampReq
}

export interface ActionResult {
    at: Date | { seconds: number; nanos: number } | undefined
    receivedAs: string
}
