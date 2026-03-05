import { AsyncLocalStorage } from 'node:async_hooks'

import { Context, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api'
import pTimeout from 'p-timeout'

import { MetricsService, RequestMechanism, RequestStatus } from '@diia-inhouse/diia-metrics'
import { ErrorType } from '@diia-inhouse/errors'
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

import { AppAction, GrpcAppAction } from './interfaces'
import { ExecuteActionParams } from './interfaces/actionExecutor'
import { ATTR_MESSAGE_ID, ATTR_MESSAGE_TYPE, ATTR_MESSAGING_SYSTEM } from './interfaces/tracing'

export class ActionExecutor {
    private readonly actionLockTtl = 30000

    constructor(
        private readonly asyncLocalStorage: AsyncLocalStorage<AlsData>,
        private readonly logger: Logger,
        private readonly validator: AppValidator,
        private readonly systemServiceName: string,
        private readonly metrics: MetricsService,
        private readonly redlock: RedlockService | null = null,
    ) {}

    async execute(params: ExecuteActionParams): Promise<unknown> {
        const { action, transport, tracingMetadata, spanKind, actionArguments } = params

        const tracer = trace.getTracer(this.systemServiceName)

        const telemetryActiveContext = propagation.extract(context.active(), tracingMetadata)
        let actionName = action.name
        if (transport === RequestMechanism.Grpc && this.isGrpcAction(action)) {
            if (action.grpcMethod?.path) {
                actionName = action.grpcMethod?.path
            } else {
                this.logger.warn('GRPC action in executor is missing grpcMethod.path properties')
            }
        }

        let source = 'unknown'
        if (tracingMetadata?.sentFrom) {
            source = tracingMetadata?.sentFrom
        }

        const activeContext = this.compareSpanContext(telemetryActiveContext)

        const span = tracer.startSpan(
            `handle ${actionName}`,
            {
                kind: spanKind,
                attributes: {
                    [ATTR_MESSAGING_SYSTEM]: transport,
                    ...(source !== 'unknown' && { 'messaging.caller': source }),
                },
            },
            activeContext,
        )

        const startTime = process.hrtime.bigint()
        const defaultLabels = {
            mechanism: transport,
            source,
            destination: this.systemServiceName,
            route: actionName,
        }

        span.addEvent('message', { [ATTR_MESSAGE_ID]: 1, [ATTR_MESSAGE_TYPE]: 'RECEIVED' })

        return await context.with(trace.setSpan(telemetryActiveContext, span), async () => {
            const logData = this.buildLogData(actionArguments)
            const { params, session, headers } = actionArguments
            const alsData: AlsData = { logData: this.logger.prepareContext(logData), session, headers }

            return await this.asyncLocalStorage?.run(alsData, async () => {
                this.logger.info(`ACT IN: ${actionName}`, { version: action.actionVersion, params, session, transport })

                const actionLockResource = action.getLockResource?.(actionArguments)
                let lock

                if (actionLockResource && this.redlock) {
                    const lockResource = `${action.name}.${actionLockResource}`

                    try {
                        lock = await pTimeout(
                            this.redlock.lock(lockResource, this.actionLockTtl).catch((err) => {
                                this.logger.error(`Caught error while acquiring lock for action: ${actionName}`, { err })
                            }),
                            action.tryLockTimeout ?? Infinity,
                            () => {},
                        )
                    } catch (err) {
                        this.logger.error(`Failed to acquire lock for action: ${actionName}`, { err })
                    }
                }

                try {
                    const validationSchema = { params: { type: 'object', props: action.validationRules } }
                    const validationErrorType = session?.sessionType === SessionType.Partner ? ErrorType.Operated : undefined

                    this.validator.validate(actionArguments, validationSchema, validationErrorType)

                    if (headers) {
                        headers.serviceCode = action.getServiceCode?.(actionArguments)
                    }

                    const res = await action.handler(actionArguments)

                    this.logger.info(`ACT IN RESULT: ${actionName}`, res)
                    this.metrics.responseTotalTimerMetric.observeSeconds(
                        { ...defaultLabels, status: RequestStatus.Successful },
                        process.hrtime.bigint() - startTime,
                    )
                    span.setStatus({ code: SpanStatusCode.OK })
                    span.addEvent('message', { [ATTR_MESSAGE_ID]: 2, [ATTR_MESSAGE_TYPE]: 'SENT' })

                    return res
                } catch (err) {
                    this.logger.error(`ACT IN FAILED: ${actionName}`, { err, version: action.actionVersion, params, session })

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
                    span.addEvent('message', { [ATTR_MESSAGE_ID]: 2, [ATTR_MESSAGE_TYPE]: 'SENT' })

                    throw err
                } finally {
                    span.end()
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
                } = session as UserSession

                logData.userIdentifier = identifier

                break
            }
            case SessionType.ServiceUser: {
                const {
                    serviceUser: { login },
                } = session as ServiceUserSession

                logData.sessionOwnerId = login

                break
            }
            case SessionType.Partner: {
                const {
                    partner: { _id: id },
                } = session as PartnerSession

                logData.sessionOwnerId = id.toString()

                break
            }
            case SessionType.Acquirer: {
                const {
                    acquirer: { _id: id },
                } = session as AcquirerSession

                logData.sessionOwnerId = id.toString()

                break
            }
            case SessionType.Temporary: {
                const {
                    temporary: { mobileUid },
                } = session as TemporarySession

                logData.sessionOwnerId = mobileUid

                break
            }
            case SessionType.ServiceEntrance: {
                const {
                    entrance: { acquirerId },
                } = session as ServiceEntranceSession

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

    private isGrpcAction(action: AppAction): action is GrpcAppAction {
        return 'grpcMethod' in action
    }

    private compareSpanContext(customContext: Context): Context {
        const customSpanContext = trace.getSpanContext(customContext)

        const activeSpan = trace.getSpan(context.active())
        const activeSpanContext = activeSpan ? activeSpan.spanContext() : null

        let parentContext = context.active()

        if (customSpanContext) {
            const isMatchingTrace = activeSpanContext?.traceId === customSpanContext?.traceId

            parentContext = isMatchingTrace ? context.active() : customContext
        }

        return parentContext
    }
}
