import { ServiceActionArguments } from '@diia-inhouse/types'

import { SubscribeTestReq, TestEvent } from '../../../generated/test-service'

export interface CustomActionArguments extends ServiceActionArguments {
    params: SubscribeTestReq
}

export type ActionResult = TestEvent
