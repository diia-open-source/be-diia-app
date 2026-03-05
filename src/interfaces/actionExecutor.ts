import { SpanKind } from '@opentelemetry/api'

import { RequestMechanism } from '@diia-inhouse/diia-metrics'
import { ActionArguments } from '@diia-inhouse/types'

import { AppAction } from './action'

export interface MetaTracing {
    traceparent?: string
    tracestate?: string
}

export interface ExecuteActionParams {
    action: AppAction
    transport: RequestMechanism
    caller?: string
    tracingMetadata?: { [key: string]: string | undefined }
    spanKind: SpanKind
    actionArguments: ActionArguments
}
