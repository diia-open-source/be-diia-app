import { AsyncLocalStorage } from 'async_hooks'

import { SpanKind } from '@opentelemetry/api'
import { ActionHandler, ActionParams, ActionSchema, Context, ServiceActionsSchema } from 'moleculer'

import { MetricsService, RequestMechanism } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import type { RedlockService } from '@diia-inhouse/redis'
import { ActionContext, ActionSession, ActionVersion, AlsData, Logger, SessionType } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'
import { AppValidator, ValidationRule } from '@diia-inhouse/validators'

import { DiiaActionExecutor } from './actionExecutor'
import { ActionValidationRules, AppAction } from './interfaces/action'
import { ACTION_RESPONSE } from './plugins/pluginConstants'

export default class ActionFactory {
    static readonly sessionTypeToValidationRule: Partial<Record<SessionType, ValidationRule>> = {
        [SessionType.Acquirer]: {
            type: 'object',
            props: {
                acquirer: {
                    type: 'object',
                    props: {
                        _id: { type: 'objectId' },
                    },
                },
            },
        },
        [SessionType.Partner]: {
            type: 'object',
            props: {
                partner: {
                    type: 'object',
                    props: {
                        _id: { type: 'objectId' },
                    },
                },
            },
        },
    }

    private readonly actionExecutor: DiiaActionExecutor

    constructor(
        private readonly envService: EnvService,
        asyncLocalStorage: AsyncLocalStorage<AlsData>,
        private readonly logger: Logger,
        validator: AppValidator,
        serviceName: string,
        metrics: MetricsService,
        private readonly redlock?: RedlockService,
    ) {
        this.actionExecutor = new DiiaActionExecutor(asyncLocalStorage, logger, validator, serviceName, metrics, redlock)
    }

    createActions(actions: AppAction[]): ServiceActionsSchema {
        this.logger.info('Start actions initialization')

        try {
            const serviceActions: ServiceActionsSchema = {}

            actions.forEach((action) => {
                let actionVersion: ActionVersion | undefined
                if (typeof action.actionVersion !== 'undefined') {
                    actionVersion = action.actionVersion
                }

                const command = utils.getActionNameWithVersion(action.name, actionVersion)

                serviceActions[command] = this.addAction(action, ActionFactory.getActionValidationRules(action))

                this.logger.info(`Action [${command}] initialized successfully`)
            })

            return serviceActions
        } catch (err) {
            this.logger.error('Failed to init actions', { err })
            throw err
        }
    }

    static getActionValidationRules(action: AppAction): ActionValidationRules {
        const validationRules: ActionValidationRules = {}
        if (typeof action.validationRules !== 'undefined') {
            validationRules.params = { type: 'object', props: action.validationRules }
        }

        const sessionType: SessionType = action.sessionType
        if (Object.keys(this.sessionTypeToValidationRule).includes(sessionType)) {
            validationRules.session = this.sessionTypeToValidationRule[sessionType]
        }

        return validationRules
    }

    private addAction(action: AppAction, validationRules: ActionValidationRules): ActionSchema {
        if (action.getLockResource && !this.redlock) {
            throw new Error('Lock resource cannot be used without a redlock service')
        }

        const handler: ActionHandler = async (ctx: Context<ActionSession, Record<string, unknown>> & ActionContext): Promise<unknown> => {
            const { action: act, caller, headers, meta, params, session } = ctx

            return await this.actionExecutor.execute(
                {
                    action: {
                        service: {
                            name: act?.service?.name,
                        },
                        name: act?.name,
                        rawName: act?.rawName,
                    },
                    caller: caller,
                    headers: headers,
                    meta: meta,
                    params: params,
                    session: session,
                    transport: 'moleculer',
                    msgSystem: RequestMechanism.Moleculer,
                    spanKind: SpanKind.CONSUMER,
                },
                validationRules,
                action,
            )
        }

        return {
            handler,
            params: <ActionParams>validationRules,
            [ACTION_RESPONSE]: this.envService.isProd() ? null : action[ACTION_RESPONSE],
        }
    }
}
