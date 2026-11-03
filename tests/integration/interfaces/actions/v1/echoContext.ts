import { ServiceActionArguments } from '@diia-inhouse/types'

import { EchoContextReq, EchoContextRes } from '../../../generated/test-service'

export interface CustomActionArguments extends ServiceActionArguments {
    params: EchoContextReq
}

export type ActionResult = EchoContextRes
