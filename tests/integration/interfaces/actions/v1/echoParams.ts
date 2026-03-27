import { ServiceActionArguments } from '@diia-inhouse/types'

import { EchoParamsReq, EchoParamsRes } from '../../../generated/test-service'

export interface CustomActionArguments extends ServiceActionArguments {
    params: EchoParamsReq
}

export type ActionResult = EchoParamsRes
