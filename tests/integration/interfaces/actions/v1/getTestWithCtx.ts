import { ActionContext, EResidentSession, UserSession } from '@diia-inhouse/types'

import { GetTestReq, GetTestRes } from '../../../generated/test-service'

export type Context = ActionContext<GetTestReq, UserSession | EResidentSession>

export type ActionResult = GetTestRes
