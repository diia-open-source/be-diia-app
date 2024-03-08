import { MethodDefinition } from '@grpc/grpc-js'

import { ActionArguments, ActionVersion, GenericObject, PublicServiceCode, SessionType } from '@diia-inhouse/types'
import { ValidationRule, ValidationSchema } from '@diia-inhouse/validators'

export interface AppAction {
    sessionType: SessionType
    actionVersion?: ActionVersion
    name: string
    validationRules?: ValidationSchema
    getLockResource?(args: ActionArguments): string
    getServiceCode?(args: ActionArguments): PublicServiceCode
    handler(args: ActionArguments): unknown

    /** @info use only for development! */
    __actionResponse?: GenericObject
}

/**
 * marker interface indicates that action supports communication via grpc transport
 */
export interface GrpcAppAction extends AppAction {
    grpcMethod?: MethodDefinition<unknown, unknown>
}

export interface ActionValidationRules {
    params?: ValidationRule
    file?: ValidationRule
    session?: ValidationRule
}
