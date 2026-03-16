import { randomUUID } from 'node:crypto'

import {
    Metadata,
    MethodDefinition,
    ServerErrorResponse,
    ServerUnaryCall,
    ServerWritableStream,
    ServiceDefinition,
    UntypedHandleCall,
    UntypedServiceImplementation,
} from '@grpc/grpc-js'
import { Span, SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api'

import { RequestMechanism } from '@diia-inhouse/diia-metrics'
import { ApiError, HttpError } from '@diia-inhouse/errors'
import type { HealthCheck } from '@diia-inhouse/healthcheck'
import {
    ActionVersion,
    GrpcStatusCode,
    HealthCheckResult,
    HttpStatusCode,
    Logger,
    MimeType,
    OnHealthCheck,
    OnInit,
    PlatformType,
    SessionType,
    grpcMetadataKeys,
} from '@diia-inhouse/types'
import { ActHeaders, GenericObject } from '@diia-inhouse/types/dist/types/common'
import { OnDestroy } from '@diia-inhouse/types/dist/types/interfaces/onDestroy'
import { ActionSession } from '@diia-inhouse/types/dist/types/session/session'
import { utils } from '@diia-inhouse/utils'

import { ActionExecutor } from '../actionExecutor'
import {
    AppAction,
    BaseConfig,
    ErrorCode,
    GrpcAppAction,
    GrpcMethodType,
    GrpcServerStreamAction,
    GrpcServiceStatus,
    MetaTracing,
} from '../interfaces'
import { OnInitResults } from '../interfaces/onInitResults'
import { GrpcServer } from './server'
import { registerWrappers } from './wrappers'

export class GrpcService implements OnInit, OnDestroy, OnHealthCheck {
    private readonly grpcServer: GrpcServer | undefined

    private readonly streamConnections: Map<string, ServerWritableStream<GenericObject, unknown>> = new Map()

    private readonly httpCodeToGrpcCode: Record<number, GrpcStatusCode> = {
        [HttpStatusCode.PROCESSING]: GrpcStatusCode.OK,
        [HttpStatusCode.OK]: GrpcStatusCode.OK,
        [HttpStatusCode.CREATED]: GrpcStatusCode.OK,
        [HttpStatusCode.ACCEPTED]: GrpcStatusCode.OK,
        [HttpStatusCode.NO_CONTENT]: GrpcStatusCode.OK,
        [HttpStatusCode.PARTIAL_CONTENT]: GrpcStatusCode.OK,
        [HttpStatusCode.BAD_REQUEST]: GrpcStatusCode.INVALID_ARGUMENT,
        [HttpStatusCode.UNPROCESSABLE_ENTITY]: GrpcStatusCode.INVALID_ARGUMENT,
        [HttpStatusCode.UNAUTHORIZED]: GrpcStatusCode.UNAUTHENTICATED,
        [HttpStatusCode.FORBIDDEN]: GrpcStatusCode.PERMISSION_DENIED,
        [HttpStatusCode.NOT_FOUND]: GrpcStatusCode.NOT_FOUND,
        [HttpStatusCode.REQUEST_TIMEOUT]: GrpcStatusCode.DEADLINE_EXCEEDED,
        [HttpStatusCode.TOO_MANY_REQUESTS]: GrpcStatusCode.RESOURCE_EXHAUSTED,
        [HttpStatusCode.INTERNAL_SERVER_ERROR]: GrpcStatusCode.INTERNAL,
        [HttpStatusCode.NOT_IMPLEMENTED]: GrpcStatusCode.UNIMPLEMENTED,
        [HttpStatusCode.BAD_GATEWAY]: GrpcStatusCode.UNAVAILABLE,
        [HttpStatusCode.SERVICE_UNAVAILABLE]: GrpcStatusCode.UNAVAILABLE,
        [HttpStatusCode.GATEWAY_TIMEOUT]: GrpcStatusCode.DEADLINE_EXCEEDED,
        [0]: GrpcStatusCode.UNKNOWN,
    }

    constructor(
        private readonly config: BaseConfig,
        private readonly actionList: AppAction[],
        private readonly logger: Logger,
        private readonly actionExecutor: ActionExecutor,
        private readonly systemServiceName: string,
        private readonly serviceName: string,
        private readonly healthCheck: HealthCheck | undefined,
    ) {
        if (!this.config.grpcServer?.isEnabled) {
            this.logger.info('grpc server disabled')

            return
        }

        registerWrappers(this.logger)
        this.grpcServer = new GrpcServer(
            this.config.grpcServer,
            this.logger,
            this.config.healthCheck?.isEnabled ? this.healthCheck : undefined,
            this.serviceName,
            utils.getServiceVersion(),
        )
    }

    async onHealthCheck(): Promise<HealthCheckResult<GrpcServiceStatus>> {
        if (!this.grpcServer) {
            return { status: HttpStatusCode.OK, details: { grpcServer: 'DISABLED' } }
        }

        const status = this.grpcServer.getStatus()

        return {
            status: status === 'SERVING' ? HttpStatusCode.OK : HttpStatusCode.SERVICE_UNAVAILABLE,
            details: { grpcServer: status },
        }
    }

    async onInit(): Promise<OnInitResults['grpcService']> {
        if (!this.grpcServer) {
            return {}
        }

        const port = await this.grpcServer.start(this.provideGrpcServiceImplementation.bind(this))

        return { serverPort: port }
    }

    async onDestroy(): Promise<void> {
        for (const connection of Array.from(this.streamConnections.values())) {
            connection.end()
        }

        this.streamConnections.clear()
        await this.grpcServer?.stop()
    }

    private provideGrpcServiceImplementation(service: ServiceDefinition): UntypedServiceImplementation {
        const serviceImplementation: UntypedServiceImplementation = {}

        for (const grpcMethod in service) {
            const method = service[grpcMethod]

            if ('originalName' in method && 'path' in method) {
                const originalName = method.originalName
                if (!originalName) {
                    throw new Error('Original name in method object is undefined')
                }

                switch (this.getMethodType(method)) {
                    case GrpcMethodType.UNARY: {
                        serviceImplementation[grpcMethod] = this.provideGrpcMethodImplementation(
                            this.provideAppActions(originalName, method),
                        )
                        break
                    }
                    case GrpcMethodType.SERVER_STREAM: {
                        serviceImplementation[grpcMethod] = this.provideStreamGrpcMethodImplementation(
                            this.provideAppActions(originalName, method),
                        )
                        break
                    }
                    case GrpcMethodType.BIDI_STREAM: {
                        serviceImplementation[grpcMethod] = this.provideStreamGrpcMethodImplementation(
                            this.provideAppActions(originalName, method),
                        )
                        break
                    }
                    case GrpcMethodType.CLIENT_STREAM: {
                        throw new Error('Client streaming not supported')
                    }
                }
            }
        }

        return serviceImplementation
    }

    private getMethodType(method: MethodDefinition<unknown, unknown>): GrpcMethodType {
        if (!method.requestStream && !method.responseStream) {
            return GrpcMethodType.UNARY
        } else if (!method.requestStream && method.responseStream) {
            return GrpcMethodType.SERVER_STREAM
        } else if (method.requestStream && !method.responseStream) {
            return GrpcMethodType.CLIENT_STREAM
        } else {
            return GrpcMethodType.BIDI_STREAM
        }
    }

    private provideStreamGrpcMethodImplementation(actions: Map<ActionVersion, GrpcAppAction>): UntypedHandleCall {
        return async (input: ServerWritableStream<GenericObject, unknown>) => {
            const { metadata, request } = input
            const streamId = randomUUID()

            metadata.set(grpcMetadataKeys.STREAM_ID, streamId)

            const headers = this.prepareActHeadersFromGrpcInput(metadata, Array.from(actions.keys()))
            const actionInstance = this.getActionInstance(headers.actionVersion, actions) as GrpcServerStreamAction
            const mobileUid = headers.mobileUid

            let tracing: MetaTracing | undefined
            if (headers.tracing) {
                tracing = JSON.parse(headers.tracing)
            }

            if (!headers.traceparent) {
                headers.traceparent = tracing?.traceparent
            }

            if (!headers.tracestate) {
                headers.tracestate = tracing?.tracestate
            }

            const tracer = trace.getTracer(this.systemServiceName)

            let actionName = 'unknown'
            const baseActionInstance = actionInstance as GrpcAppAction
            if (baseActionInstance.grpcMethod?.path) {
                actionName = baseActionInstance.grpcMethod?.path
            }

            const baseAttributes = {
                mobile_uid: mobileUid,
                stream_id: streamId,
            }

            const telemetryActiveContext = propagation.extract(context.active(), headers)

            const span = tracer.startSpan(
                `grpc stream ${actionName}`,
                { kind: SpanKind.SERVER, attributes: baseAttributes },
                telemetryActiveContext,
            )

            await context.with(trace.setSpan(telemetryActiveContext, span), async () => {
                this.streamConnections.set(streamId, input)
                if ('subscribeChannel' in actionInstance && mobileUid) {
                    const handler = async (data: GenericObject): Promise<void> => {
                        this.logger.info('Publishing to channel ' + mobileUid, data)
                        span.addEvent('channelPublish')
                        input.write(data)
                    }

                    const streamKey = { mobileUid, streamId }

                    try {
                        span.addEvent('subscribeChannel')
                        actionInstance.subscribeChannel(streamKey, handler)
                    } catch (err) {
                        utils.handleError(err, (error) => {
                            span.recordException({
                                message: error.getMessage(),
                                code: error.getCode(),
                                name: error.getName(),
                            })

                            if (error.getCode() === ErrorCode.SubscriptionsExists) {
                                const subscriptions = (error.getData().subscriptions as string[]) ?? []

                                this.logger.info(`Closing existing connections by mobileUid ${mobileUid}`, { subscriptions })
                                for (const existingStreamId of subscriptions) {
                                    const connection = this.streamConnections.get(existingStreamId)
                                    if (connection) {
                                        actionInstance.unsubscribeChannel({ streamId: existingStreamId, mobileUid })
                                        connection.end()
                                    }
                                }

                                actionInstance.subscribeChannel(streamKey, handler)
                                span.addEvent('channelReconnect')

                                return
                            }

                            this.logger.error('Failed to subscribe to grpc stream channel', { error: error.getMessage(), mobileUid })

                            this.logger.error('Failed to reopen connection for the mobileUid ' + mobileUid)

                            input.end()
                            span.setStatus({ code: SpanStatusCode.ERROR, message: error.getMessage() })
                            span.end()
                        })
                    }
                }

                if ('onConnectionOpened' in actionInstance) {
                    try {
                        actionInstance.onConnectionOpened(headers, request)
                        span.addEvent('onConnectionOpened')
                    } catch (err) {
                        utils.handleError(err, (error) => {
                            span.recordException({
                                message: error.getMessage(),
                                code: error.getCode(),
                                name: error.getName(),
                            })
                            span.setStatus({ code: SpanStatusCode.ERROR, message: error.getMessage() })
                            this.logger.error('Failed to open action connection', { err: error })
                        })

                        input.end()
                        span.end()
                    }
                }

                input.addListener('end', () => {
                    this.logger.info('Grpc stream ended', { streamId })

                    span.addEvent('stream ended')
                    span.end()
                    input.end()
                })
                input.prependListener('close', () => {
                    if ('unsubscribeChannel' in actionInstance && mobileUid) {
                        actionInstance.unsubscribeChannel({ mobileUid, streamId })
                        span.addEvent('unsubscribeChannel')
                    }

                    if ('onConnectionClosed' in actionInstance) {
                        try {
                            actionInstance.onConnectionClosed(headers, request)
                            span.addEvent('onConnectionClosed')
                        } catch (err) {
                            utils.handleError(err, (error) => {
                                span.recordException({
                                    message: error.getMessage(),
                                    code: error.getCode(),
                                    name: error.getName(),
                                })

                                this.logger.error('Failed to close action connection gracefully', { err: error })
                            })
                        }
                    }

                    this.logger.info('Grpc stream closed', { streamId })

                    this.streamConnections.delete(streamId)

                    span.addEvent('stream closed')
                    span.end()
                })
                input.prependListener('error', (err) => {
                    span.recordException({
                        name: err.name,
                        message: err.message,
                    })
                    this.logger.error('Error in grpc stream', { name: err.name, message: err.message, stack: err.stack, streamId })
                })
                input.addListener('data', async (data: GenericObject) => {
                    const ctx = trace.setSpanContext(context.active(), span.spanContext())
                    const dataSpan = tracer.startSpan(`onData ${actionName}`, { kind: SpanKind.SERVER, attributes: baseAttributes }, ctx)

                    await context.with(trace.setSpan(ctx, dataSpan), async () => {
                        dataSpan.setAttributes({
                            mobile_uid: mobileUid,
                            stream_id: streamId,
                        })

                        try {
                            const response = await this.executeAction(actionInstance, metadata, headers, data)

                            if (response) {
                                input.write(response)
                            }
                        } catch (err) {
                            utils.handleError(err, (error) => {
                                dataSpan.recordException({
                                    message: error.getMessage(),
                                    code: error.getCode(),
                                    name: error.getName(),
                                })
                                dataSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.getMessage() })
                                this.logger.error('Failed to open action connection', { err: error })
                            })
                        } finally {
                            dataSpan.end()
                        }
                    })
                })

                if (request) {
                    span.addEvent('writing data into stream', {
                        keys: Object.keys(request),
                    })
                    input.emit('data', request)
                }
            })
        }
    }

    private provideGrpcMethodImplementation(actions: Map<ActionVersion, GrpcAppAction>): UntypedHandleCall {
        return async (
            input: ServerUnaryCall<GenericObject, unknown>,
            callback: (err: ServerErrorResponse | null, resp: unknown) => void,
        ) => {
            const tracer = trace.getTracer(this.systemServiceName)

            await tracer.startActiveSpan('grpc start', async (span: Span) => {
                const responseMetadata = new Metadata()

                responseMetadata.set(grpcMetadataKeys.HANDLED_BY, this.systemServiceName)

                try {
                    const { metadata, request: params } = input
                    const headers = this.prepareActHeadersFromGrpcInput(metadata, Array.from(actions.keys()))
                    const actionInstance = this.getActionInstance(headers.actionVersion, actions)

                    if (actionInstance.grpcMethod?.path) {
                        span.updateName(`start ${actionInstance.grpcMethod?.path}`)
                    }

                    let tracing: MetaTracing | undefined
                    if (headers.tracing) {
                        tracing = JSON.parse(headers.tracing)
                    }

                    if (!headers.traceparent) {
                        headers.traceparent = tracing?.traceparent
                    }

                    if (!headers.tracestate) {
                        headers.tracestate = tracing?.tracestate
                    }

                    const response = await this.executeAction(actionInstance, metadata, headers, params)

                    span.addEvent('executeAction called')

                    input.sendMetadata(responseMetadata)

                    if (callback) {
                        callback(null, response)
                        span.addEvent('callback called')
                    }

                    span.setStatus({ code: SpanStatusCode.OK })
                } catch (err) {
                    this.logger.error('Error while executing grpc method', { err })

                    utils.handleError(err, (apiError) => {
                        callback(this.mapApiErrorToRpcError(apiError, responseMetadata), null)

                        span.recordException({
                            message: apiError.getMessage(),
                            code: apiError.getCode(),
                            name: apiError.getName(),
                        })
                        span.setStatus({ code: SpanStatusCode.ERROR, message: apiError.getMessage() })
                    })
                } finally {
                    span.end()
                }
            })
        }
    }

    private getActionInstance(actionVersion: ActionVersion, actions: Map<ActionVersion, GrpcAppAction>): GrpcAppAction {
        const actionInstance = actions.get(actionVersion)
        if (actionInstance) {
            return actionInstance
        }

        const actionInstanceByDefaultVersion = actions.get(ActionVersion.V1)
        if (!actionInstanceByDefaultVersion || actionInstanceByDefaultVersion.actionVersion) {
            throw new HttpError('action not found for version ' + actionVersion, HttpStatusCode.NOT_IMPLEMENTED)
        }

        return actionInstanceByDefaultVersion
    }

    private async executeAction(action: GrpcAppAction, metadata: Metadata, headers: ActHeaders, params: GenericObject): Promise<unknown> {
        const actionArguments = {
            session: this.prepareActSessionFromGrpcInput(metadata) || { sessionType: SessionType.None },
            headers,
            params,
        }

        return await this.actionExecutor.execute({
            action,
            tracingMetadata: headers,
            actionArguments,
            transport: RequestMechanism.Grpc,
            spanKind: SpanKind.SERVER,
        })
    }

    private provideAppActions(actionName: string, grpcMethod: MethodDefinition<unknown, unknown>): Map<ActionVersion, GrpcAppAction> {
        const actions = new Map<ActionVersion, GrpcAppAction>()
        const actionInstances = this.actionList.filter((action): action is GrpcAppAction => action.name === actionName)
        if (actionInstances.length === 0) {
            throw new Error(`Unable to find any action for ${actionName}`)
        }

        for (const actionInstance of actionInstances) {
            const actionVersion = actionInstance.actionVersion ?? ActionVersion.V1

            actionInstance.grpcMethod = grpcMethod
            actions.set(actionVersion, actionInstance)

            if (this.grpcServer?.schemaRegistry) {
                const sessionType = Array.isArray(actionInstance.sessionType)
                    ? actionInstance.sessionType.join(',')
                    : String(actionInstance.sessionType)

                this.grpcServer.schemaRegistry.setActionInfo(grpcMethod.path, actionInstance.name, sessionType)
            }
        }

        return actions
    }

    private prepareActHeadersFromGrpcInput(metadata: Metadata, actVersions: ActionVersion[]): ActHeaders {
        const headers: ActHeaders = { actionVersion: this.getDefaultActionVersion(actVersions), traceId: randomUUID() }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.ACTION_VERSION)) {
            headers.actionVersion = metadata.get(grpcMetadataKeys.ACTION_VERSION)[0] as ActionVersion
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.TRACE_ID)) {
            headers.traceId = metadata.get(grpcMetadataKeys.TRACE_ID)[0] as string
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.ACCEPT_LANGUAGE)) {
            headers.acceptLanguage = metadata.get(grpcMetadataKeys.ACCEPT_LANGUAGE)[0] as string
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.PLATFORM_TYPE)) {
            headers.platformType = metadata.get(grpcMetadataKeys.PLATFORM_TYPE)[0] as PlatformType
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.MOBILE_UID)) {
            headers.mobileUid = metadata.get(grpcMetadataKeys.MOBILE_UID)[0] as string
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.APP_VERSION)) {
            headers.appVersion = metadata.get(grpcMetadataKeys.APP_VERSION)[0] as string
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.PLATFORM_VERSION)) {
            headers.platformVersion = metadata.get(grpcMetadataKeys.PLATFORM_VERSION)[0] as string
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.SERVICE_CODE)) {
            headers.serviceCode = metadata.get(grpcMetadataKeys.SERVICE_CODE)[0] as string
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.TRACING)) {
            headers.tracing = metadata.get(grpcMetadataKeys.TRACING)[0] as string
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.TRACE_PARENT)) {
            headers.traceparent = metadata.get(grpcMetadataKeys.TRACE_PARENT)[0] as string
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.TRACE_STATE)) {
            headers.tracestate = metadata.get(grpcMetadataKeys.TRACE_STATE)[0] as string
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.CONTENT_TYPE)) {
            headers.contentType = metadata.get(grpcMetadataKeys.CONTENT_TYPE)[0] as MimeType
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.SENT_FROM)) {
            headers.sentFrom = metadata.get(grpcMetadataKeys.SENT_FROM)[0] as string
        }

        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.TOKEN)) {
            headers.token = metadata.get(grpcMetadataKeys.TOKEN)[0] as string
        }

        return headers
    }

    private prepareActSessionFromGrpcInput(metadata: Metadata): ActionSession | undefined {
        if (this.hasMetadataProperty(metadata, grpcMetadataKeys.SESSION)) {
            return JSON.parse(Buffer.from(metadata.get(grpcMetadataKeys.SESSION)[0] as string, 'base64').toString())
        }

        return undefined
    }

    private hasMetadataProperty(metadata: Metadata, key: string): boolean {
        return metadata.get(key).length > 0
    }

    private getDefaultActionVersion(actVersions: ActionVersion[]): ActionVersion {
        if (actVersions.length > 1) {
            const actVersionsOrder = Object.values(ActionVersion)

            return actVersions.toSorted((a, b) => actVersionsOrder.indexOf(b) - actVersionsOrder.indexOf(a))[0]
        }

        return actVersions[0]
    }

    private mapApiErrorToRpcError(apiError: ApiError, metadata: Metadata): ServerErrorResponse {
        const errorData = apiError.getData()
        const processCode = errorData.processCode

        if (processCode) {
            metadata.set(grpcMetadataKeys.PROCESS_CODE, processCode.toString())
        }

        metadata.set(grpcMetadataKeys.ORIGINAL_ERROR, this.serializeApiError(apiError))

        const rpcErrorCode: number = this.httpCodeToGrpcCode[apiError.getCode()] ?? this.httpCodeToGrpcCode[errorData.code ?? 0]
        const rpcError: ServerErrorResponse = {
            ...apiError,
            code: rpcErrorCode,
            details: apiError.getMessage(),
            metadata,
        }

        return rpcError
    }

    private serializeApiError(apiError: ApiError): string {
        return JSON.stringify({
            name: apiError.getName(),
            message: utils.encodeValuesWithIterator(apiError.getMessage()),
            code: apiError.getCode(),
            type: apiError.getType(),
            data: utils.encodeValuesWithIterator(apiError.getData()),
        })
    }
}
