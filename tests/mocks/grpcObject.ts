import { GrpcObject, ServiceClientConstructor, ServiceDefinition } from '@grpc/grpc-js'
import { AppAction } from 'src'

import { ApiError } from '@diia-inhouse/errors'
import { ActionVersion, AppUserActionHeaders, HttpStatusCode, ServiceActionArguments, SessionType } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

interface GrpcActionArguments extends ServiceActionArguments<AppUserActionHeaders> {
    params: { param: string }
}

interface GrpcActionErrorArguments extends ServiceActionArguments<AppUserActionHeaders> {
    params: { param: string; processCode?: number }
}

export const grpcObjectWithAction: GrpcObject = {
    'service-with-action': {
        service: {
            action: {
                originalName: 'action',
                path: '/action',
            },
        } as unknown as ServiceDefinition,
        serviceName: 'action',
    } as ServiceClientConstructor,
}

export const grpcObjectWithActionError: GrpcObject = {
    'service-with-action-error': {
        service: {
            'action-error': {
                originalName: 'action-error',
                path: '/action-error',
            },
        } as unknown as ServiceDefinition,
        serviceName: 'action-error',
    } as ServiceClientConstructor,
}

export const grpcObjectActionRedlock: GrpcObject = {
    'service-with-action-redlock': {
        service: {
            'action-redlock': {
                originalName: 'action-redlock',
                path: '/action-redlock',
            },
        } as unknown as ServiceDefinition,
        serviceName: 'action-redlock',
    } as ServiceClientConstructor,
}

export class GrpcAction implements AppAction {
    readonly name: string = 'action'

    readonly actionVersion: ActionVersion = ActionVersion.V1

    readonly validationRules: ValidationSchema = {
        param: { type: 'string' },
    }

    readonly sessionType: SessionType = SessionType.User

    async handler(args: GrpcActionArguments): Promise<string> {
        return args.params.param
    }
}

export class GrpcActionError implements AppAction {
    readonly name: string = 'action-error'

    readonly actionVersion: ActionVersion = ActionVersion.V1

    readonly validationRules: ValidationSchema = {
        param: { type: 'string', enum: Object.values(HttpStatusCode).map(String) },
        processCode: { type: 'number', optional: true },
    }

    readonly sessionType: SessionType = SessionType.User

    async handler(args: GrpcActionErrorArguments): Promise<string> {
        throw new ApiError('Mocked error', Number.parseInt(args.params.param), {}, args.params.processCode)
    }
}

export class GrpcActionRedlock implements AppAction {
    readonly name: string = 'action-redlock'

    readonly actionVersion: ActionVersion = ActionVersion.V1

    readonly sessionType: SessionType = SessionType.User

    getLockResource(args: ServiceActionArguments<AppUserActionHeaders>): string {
        const {
            headers: { mobileUid },
        } = args

        return `action-redlock-${mobileUid}`
    }

    async handler(): Promise<boolean> {
        return true
    }
}
