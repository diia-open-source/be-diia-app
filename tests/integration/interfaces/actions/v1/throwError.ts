import { ServiceActionArguments } from '@diia-inhouse/types'

import { ThrowErrorReq } from '../../../generated/test-service'

export interface CustomActionArguments extends ServiceActionArguments {
    params: ThrowErrorReq
}

export type ActionResult = never
