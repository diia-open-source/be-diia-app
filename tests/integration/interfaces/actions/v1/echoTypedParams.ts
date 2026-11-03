import { ServiceActionArguments } from '@diia-inhouse/types'

import { TypedParams } from '../../../generated/test-service'

export interface CustomActionArguments extends ServiceActionArguments {
    params: TypedParams
}

export type ActionResult = TypedParams
