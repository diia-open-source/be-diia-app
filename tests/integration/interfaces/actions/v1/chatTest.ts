import { ServiceActionArguments } from '@diia-inhouse/types'

import { TestEvent } from '../../../generated/test-service'

export interface CustomActionArguments extends ServiceActionArguments {
    params: TestEvent
}

export type ActionResult = TestEvent
