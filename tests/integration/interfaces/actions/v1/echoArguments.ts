import { ActHeaders, BaseSession, ServiceActionArguments } from '@diia-inhouse/types'

export type CustomActionArguments = ServiceActionArguments

export interface ActionResult {
    session: BaseSession
    headers: ActHeaders
}
