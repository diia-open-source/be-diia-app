import { ServiceActionArguments } from '@diia-inhouse/types'

import { GetTestRes, LockResourceReq } from '../../../generated/test-service'

export interface CustomActionArguments extends ServiceActionArguments {
    params: LockResourceReq
}

export type ActionResult = GetTestRes
