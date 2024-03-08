import { AsyncLocalStorage } from 'async_hooks'

import { ROOT_CONTEXT, SpanKind, context, propagation, trace } from '@opentelemetry/api'
import { SemanticAttributes } from '@opentelemetry/semantic-conventions'
import { merge } from 'lodash'

import { MetricsService, RequestMechanism, RequestStatus } from '@diia-inhouse/diia-metrics'
import { RedlockService } from '@diia-inhouse/redis'
import {
    AcquirerSession,
    ActionArguments,
    ActionSession,
    AlsData,
    LogData,
    Logger,
    PartnerSession,
    ServiceEntranceSession,
    ServiceUserSession,
    SessionType,
    TemporarySession,
    UserSession,
} from '@diia-inhouse/types'
import { ActHeaders, GenericObject } from '@diia-inhouse/types/dist/types/common'
import { convertParamsByRules, utils } from '@diia-inhouse/utils'
import { AppValidator, ValidationSchema } from '@diia-inhouse/validators'

import { actionTypesToJson } from './actionJsonConvertor'
import { ActionValidationRules, AppAction } from './interfaces'

export interface DiiaExecutionContext {
    action: {
        name?: string
        rawName: string
        service: {
            name?: string
        }
    }
    meta?: Record<string, unknown>
    caller: string | null
    params: GenericObject
    session?: ActionSession
    headers?: ActHeaders
    transport: string
    spanKind: SpanKind
    msgSystem: RequestMechanism
}

export class DiiaActionExecutor {
    constructor(
        private readonly asyncLocalStorage: AsyncLocalStorage<AlsData>,
        private readonly logger: Logger,
        private readonly validator: AppValidator,
        private readonly serviceName: string,
        private readonly metrics: MetricsService,
        private readonly redlock?: RedlockService,
    ) {}

    private readonly actionLockTtl = 30000

    async execute(ctx: DiiaExecutionContext, validationRules: ActionValidationRules, action: AppAction): Promise<unknown> {
        if (!ctx.action?.name) {
            return
        }

        const tracingHeaders = ctx.meta?.tracing

        const actionParts = ctx.action.name.split('.')
        const serviceActionName = `${ctx.action.service?.name}.${ctx.action.rawName}`
        const activeContext = propagation.extract(ROOT_CONTEXT, tracingHeaders)
        const tracer = trace.getTracer(ctx.action.service?.name || actionParts[0])
        const span = tracer.startSpan(
            `handle ${serviceActionName}`,
            {
                kind: ctx.spanKind,
                attributes: {
                    [SemanticAttributes.MESSAGING_SYSTEM]: ctx.msgSystem,
                    ...(ctx.caller ? { 'messaging.caller': ctx.caller } : {}),
                },
            },
            activeContext,
        )

        const startTime = process.hrtime.bigint()
        const defaultLabels = {
            mechanism: ctx.msgSystem,
            ...(ctx.caller && { source: ctx.caller }),
            destination: this.serviceName,
            route: serviceActionName,
        }

        context.with(trace.setSpan(activeContext, span), () => {
            try {
                if (ctx.params.session) {
                    const sessionRules: ValidationSchema = validationRules.session ? { params: validationRules.session } : {}

                    ctx.session = merge(ctx.params.session, convertParamsByRules({ params: ctx.params.session }, sessionRules).params)
                }

                const paramRules: ValidationSchema = validationRules.params ? { params: validationRules.params } : {}

                ctx.headers = ctx.params.headers
                if (ctx.transport === 'grpc') {
                    this.validator.validate(ctx.params, paramRules)
                }

                ctx.params = merge(ctx.params.params, convertParamsByRules({ params: ctx.params.params }, paramRules).params)
                if (ctx.headers) {
                    ctx.headers.serviceCode = action.getServiceCode?.(<ActionArguments>ctx)
                }
            } catch (e) {
                utils.handleError(e, (err) => {
                    this.metrics.responseTotalTimerMetric.observeSeconds(
                        {
                            ...defaultLabels,
                            status: RequestStatus.Failed,
                            errorType: err.getType(),
                            statusCode: err.getCode(),
                        },
                        process.hrtime.bigint() - startTime,
                    )
                    span.recordException({
                        name: err.getName(),
                        code: err.getCode(),
                        message: err.getMessage(),
                    })

                    span.end()
                })

                throw e
            }
        })

        const logData = this.buildLogData(ctx)

        const alsData: AlsData = {
            logData: this.logger.prepareContext(logData),
            session: ctx.session,
            headers: ctx.headers,
        }

        return await this.asyncLocalStorage?.run(alsData, async () => {
            return await context.with(trace.setSpan(activeContext, span), async () => {
                this.logger.io(`ACT IN: ${serviceActionName}`, {
                    service: actionParts[0],
                    action: actionParts[1],
                    version: actionParts[2],
                    params: ctx.params,
                    headers: ctx.headers,
                    transport: ctx.transport ?? 'moleculer',
                })

                const actionLockResource = action.getLockResource?.(<ActionArguments>ctx)
                let lock

                if (actionLockResource && this.redlock) {
                    const lockResource = `${action.name}.${actionLockResource}`

                    lock = await this.redlock.lock(lockResource, this.actionLockTtl)
                }

                let res: unknown

                try {
                    res = actionTypesToJson(await action.handler(<ActionArguments>ctx))
                    this.logger.io(`ACT IN RESULT: ${serviceActionName}`, res)

                    this.metrics.responseTotalTimerMetric.observeSeconds(
                        { ...defaultLabels, status: RequestStatus.Successful },
                        process.hrtime.bigint() - startTime,
                    )
                    span.end()
                } catch (err) {
                    this.logger.error(`ACT IN FAILED: ${serviceActionName}`, {
                        err,
                        service: actionParts[0],
                        action: actionParts[1],
                        version: actionParts[2],
                        params: ctx.params,
                    })

                    utils.handleError(err, (apiErr) => {
                        this.metrics.responseTotalTimerMetric.observeSeconds(
                            {
                                ...defaultLabels,
                                status: RequestStatus.Failed,
                                errorType: apiErr.getType(),
                                statusCode: apiErr.getCode(),
                            },
                            process.hrtime.bigint() - startTime,
                        )

                        span.recordException({
                            message: apiErr.getMessage(),
                            code: apiErr.getCode(),
                            name: apiErr.getName(),
                        })
                    })

                    span.end()
                    throw err
                } finally {
                    await lock?.release()
                }

                return res
            })
        })
    }

    private buildLogData(ctx: DiiaExecutionContext): LogData {
        const { session, headers } = ctx

        const sessionType = session?.sessionType || SessionType.None

        const logData: LogData = {
            sessionType,
            ...headers,
        }

        switch (sessionType) {
            case SessionType.PortalUser:
            case SessionType.CabinetUser:
            case SessionType.EResidentApplicant:
            case SessionType.EResident:
            case SessionType.User: {
                const {
                    user: { identifier },
                } = <UserSession>session

                logData.userIdentifier = identifier

                break
            }
            case SessionType.ServiceUser: {
                const {
                    serviceUser: { login },
                } = <ServiceUserSession>session

                logData.sessionOwnerId = login

                break
            }
            case SessionType.Partner: {
                const {
                    partner: { _id: id },
                } = <PartnerSession>session

                logData.sessionOwnerId = id.toString()

                break
            }
            case SessionType.Acquirer: {
                const {
                    acquirer: { _id: id },
                } = <AcquirerSession>session

                logData.sessionOwnerId = id.toString()

                break
            }
            case SessionType.Temporary: {
                const {
                    temporary: { mobileUid },
                } = <TemporarySession>session

                logData.sessionOwnerId = mobileUid

                break
            }
            case SessionType.ServiceEntrance: {
                const {
                    entrance: { acquirerId },
                } = <ServiceEntranceSession>session

                logData.sessionOwnerId = acquirerId.toString()

                break
            }
            case SessionType.None: {
                break
            }
            default: {
                const unexpectedSessionType: never = sessionType

                throw new Error(`Unexpected sessionType: ${unexpectedSessionType}`)
            }
        }

        return logData
    }
}
