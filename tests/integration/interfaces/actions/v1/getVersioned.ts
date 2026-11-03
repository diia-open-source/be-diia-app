import { ServiceActionArguments } from '@diia-inhouse/types'

import { GetTestReq, GetVersionedRes } from '../../../generated/test-service'

export interface CustomActionArguments extends ServiceActionArguments {
    params: GetTestReq
}

export type ActionResult = GetVersionedRes
