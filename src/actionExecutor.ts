import { AsyncLocalStorage } from 'node:async_hooks'

import { SpanStatusCode, context, propagation, trace } from '@opentelemetry/api'
import { SEMATTRS_MESSAGE_ID, SEMATTRS_MESSAGE_TYPE, SEMATTRS_MESSAGING_SYSTEM } from '@opentelemetry/semantic-conventions'

import { MetricsService, RequestStatus } from '@diia-inhouse/diia-metrics'
import { RedlockService } from '@diia-inhouse/redis'
import {
    AcquirerSession,
    ActionArguments,
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
import { utils } from '@diia-inhouse/utils'
import { AppValidator } from '@diia-inhouse/validators'

import { ExecuteActionParams } from './interfaces/actionExecutor'

export class ActionExecutor {
    constructor(
        private readonly asyncLocalStorage: AsyncLocalStorage<AlsData>,
        private readonly logger: Logger,
        private readonly validator: AppValidator,
        private readonly serviceName: string,
        private readonly metrics: MetricsService,
        private readonly redlock: RedlockService | null = null,
    ) {}

    private readonly actionLockTtl = 30000

    async execute(params: ExecuteActionParams): Promise<unknown> {
        const { action, transport, caller, tracingMetadata, spanKind, actionArguments, serviceName = this.serviceName } = params

        const serviceActionName = `${serviceName}.${action.name}`
        const telemetryActiveContext = propagation.extract(context.active(), tracingMetadata)
        const tracer = trace.getTracer(serviceName)
        const span = tracer.startSpan(
            `handle ${serviceActionName}`,
            {
                kind: spanKind,
                attributes: {
                    [SEMATTRS_MESSAGING_SYSTEM]: transport,
                    ...(caller && { 'messaging.caller': caller }),
                },
            },
            telemetryActiveContext,
        )

        const startTime = process.hrtime.bigint()
        const defaultLabels = {
            mechanism: transport,
            ...(caller && { source: caller }),
            destination: serviceName,
            route: action.name,
        }

        span.addEvent('message', { [SEMATTRS_MESSAGE_ID]: 1, [SEMATTRS_MESSAGE_TYPE]: 'RECEIVED' })

        return await context.with(trace.setSpan(telemetryActiveContext, span), async () => {
            const logData = this.buildLogData(actionArguments)

            const alsData: AlsData = {
                logData: this.logger.prepareContext(logData),
                session: actionArguments.session,
                headers: actionArguments.headers,
            }

            return await this.asyncLocalStorage?.run(alsData, async () => {
                this.logger.info(`ACT IN: ${serviceActionName}`, {
                    version: action.actionVersion,
                    params: actionArguments,
                    headers: actionArguments.headers,
                    transport,
                })

                const actionLockResource = action.getLockResource?.(actionArguments)
                let lock

                if (actionLockResource && this.redlock) {
                    const lockResource = `${action.name}.${actionLockResource}`

                    lock = await this.redlock.lock(lockResource, this.actionLockTtl)
                }

                try {
                    this.validator.validate(actionArguments, { params: { type: 'object', props: action.validationRules } })

                    if (actionArguments.headers) {
                        actionArguments.headers.serviceCode = action.getServiceCode?.(actionArguments)
                    }

                    const res = await action.handler(actionArguments)

                    this.logger.info(`ACT IN RESULT: ${serviceActionName}`, res)
                    this.metrics.responseTotalTimerMetric.observeSeconds(
                        { ...defaultLabels, status: RequestStatus.Successful },
                        process.hrtime.bigint() - startTime,
                    )
                    span.setStatus({ code: SpanStatusCode.OK })
                    span.addEvent('message', { [SEMATTRS_MESSAGE_ID]: 2, [SEMATTRS_MESSAGE_TYPE]: 'SENT' })
                    span.end()

                    return res
                } catch (err) {
                    this.logger.error(`ACT IN FAILED: ${serviceActionName}`, {
                        err,
                        version: action.actionVersion,
                        params: actionArguments,
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
                        span.setStatus({ code: SpanStatusCode.ERROR, message: apiErr.getMessage() })
                    })
                    span.addEvent('message', { [SEMATTRS_MESSAGE_ID]: 2, [SEMATTRS_MESSAGE_TYPE]: 'SENT' })
                    span.end()
                    throw err
                } finally {
                    await lock?.release()
                }
            })
        })
    }

    private buildLogData(actionArguments: ActionArguments): LogData {
        const session = 'session' in actionArguments ? actionArguments.session : null
        const sessionType = session?.sessionType ?? SessionType.None
        const logData: LogData = {
            sessionType,
            ...actionArguments.headers,
        }

        switch (sessionType) {
            case SessionType.PortalUser:
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

                this.logger.warn(`Unexpected session type for the logData: ${unexpectedSessionType}`)
            }
        }

        return logData
    }
}
