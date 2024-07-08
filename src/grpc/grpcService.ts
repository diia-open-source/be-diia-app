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
import { SpanKind } from '@opentelemetry/api'
import protobuf from 'protobufjs'

import { RequestMechanism } from '@diia-inhouse/diia-metrics'
import { ApiError, HttpError } from '@diia-inhouse/errors'
import {
    ActionVersion,
    GrpcStatusCode,
    HealthCheckResult,
    HttpStatusCode,
    Logger,
    OnHealthCheck,
    OnInit,
    PlatformType,
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

import { GrpcServer } from './server'
import wrappers from './wrappers'

export class GrpcService implements OnInit, OnDestroy, OnHealthCheck {
    constructor(
        private readonly config: BaseConfig,
        private readonly actionList: AppAction[],
        private readonly logger: Logger,
        private readonly actionExecutor: ActionExecutor,
    ) {
        if (!this.config.grpcServer?.isEnabled) {
            this.logger.info('grpc server disabled')

            return
        }

        Object.assign(protobuf.wrappers, wrappers)
        this.grpcServer = new GrpcServer(this.config.grpcServer, this.logger)
    }

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

    async onInit(): Promise<void> {
        if (!this.grpcServer) {
            return
        }

        await this.grpcServer.start(this.provideGrpcServiceImplementation.bind(this))
    }

    async onDestroy(): Promise<void> {
        for (const connection of Array.from(this.streamConnections.values())) {
            connection.end()
        }

        this.streamConnections.clear()
        await this.grpcServer?.stop()
    }

    private provideGrpcServiceImplementation(serviceName: string, service: ServiceDefinition): UntypedServiceImplementation {
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
                            serviceName,
                            this.provideAppActions(originalName, method),
                        )
                        break
                    }
                    case GrpcMethodType.SERVER_STREAM: {
                        serviceImplementation[grpcMethod] = this.provideStreamGrpcMethodImplementation(
                            serviceName,
                            this.provideAppActions(originalName, method),
                        )
                        break
                    }
                    case GrpcMethodType.BIDI_STREAM: {
                        serviceImplementation[grpcMethod] = this.provideStreamGrpcMethodImplementation(
                            serviceName,
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

    private provideStreamGrpcMethodImplementation(serviceName: string, actions: Map<ActionVersion, GrpcAppAction>): UntypedHandleCall {
        return async (input: ServerWritableStream<GenericObject, unknown>) => {
            const { metadata, request } = input
            const streamId = randomUUID()

            metadata.set('stream-id', streamId)

            const actHeaders = this.prepareActHeadersFromGrpcInput(metadata, Array.from(actions.keys()))
            const actionInstance = <GrpcServerStreamAction>this.getActionInstance(actHeaders.actionVersion, actions)
            const mobileUid = actHeaders.mobileUid

            this.streamConnections.set(streamId, input)
            if ('subscribeChannel' in actionInstance && mobileUid) {
                const handler = async (data: GenericObject): Promise<void> => {
                    this.logger.info('Publishing to channel ' + mobileUid, data)
                    input.write(data)
                }

                const streamKey = { mobileUid, streamId }

                try {
                    actionInstance.subscribeChannel(streamKey, handler)
                } catch (err) {
                    utils.handleError(err, (error) => {
                        if (error.getCode() === ErrorCode.SubscriptionsExists) {
                            const subscriptions = <string[]>error.getData().subscriptions ?? []

                            this.logger.info(`Closing existing connections by mobileUid ${mobileUid}`, { subscriptions })
                            for (const existingStreamId of subscriptions) {
                                const connection = this.streamConnections.get(existingStreamId)
                                if (connection) {
                                    actionInstance.unsubscribeChannel({ streamId: existingStreamId, mobileUid })
                                    connection.end()
                                }
                            }

                            actionInstance.subscribeChannel(streamKey, handler)

                            return
                        }

                        this.logger.error('Failed to reopen connection for the mobileUid ' + mobileUid)
                        input.end()
                    })
                }
            }

            if ('onConnectionOpened' in actionInstance) {
                try {
                    actionInstance.onConnectionOpened(actHeaders, request)
                } catch (err) {
                    utils.handleError(err, (error) => this.logger.error('Failed to open action connection', { err: error }))
                    input.end()
                }
            }

            input.addListener('end', () => {
                input.end()
            })
            input.prependListener('close', () => {
                if ('unsubscribeChannel' in actionInstance && mobileUid) {
                    actionInstance.unsubscribeChannel({ mobileUid, streamId })
                }

                if ('onConnectionClosed' in actionInstance) {
                    try {
                        actionInstance.onConnectionClosed(actHeaders, request)
                    } catch (err) {
                        utils.handleError(err, (error) => this.logger.error('Failed to close action connection gracefully', { err: error }))
                    }
                }

                this.streamConnections.delete(streamId)
            })
            input.addListener('data', async (data: GenericObject) => {
                const response = await this.executeAction(actionInstance, metadata, actHeaders, data, serviceName)

                if (response) {
                    input.write(response)
                }
            })

            if (request) {
                input.emit('data', request)
            }
        }
    }

    private provideGrpcMethodImplementation(serviceName: string, actions: Map<ActionVersion, GrpcAppAction>): UntypedHandleCall {
        return async (
            input: ServerUnaryCall<GenericObject, unknown>,
            callback: (err: ServerErrorResponse | null, resp: unknown) => void,
        ) => {
            try {
                const { metadata, request: params } = input
                const headers = this.prepareActHeadersFromGrpcInput(metadata, Array.from(actions.keys()))
                const actionInstance = this.getActionInstance(headers.actionVersion, actions)

                const response = await this.executeAction(actionInstance, metadata, headers, params, serviceName)

                if (callback) {
                    callback(null, response)
                }
            } catch (err) {
                this.logger.error('Error while executing grpc method', { err })

                utils.handleError(err, (apiError) => {
                    callback(this.mapApiErrorToRpcError(apiError), null)
                })
            }
        }
    }

    private getActionInstance(actionVersion: ActionVersion, actions: Map<ActionVersion, GrpcAppAction>): GrpcAppAction {
        const actionInstance = actions.get(actionVersion)

        if (!actionInstance) {
            throw new HttpError('action not found for version ' + actionVersion, HttpStatusCode.NOT_IMPLEMENTED)
        }

        return actionInstance
    }

    private async executeAction(
        action: GrpcAppAction,
        metadata: Metadata,
        headers: ActHeaders,
        params: GenericObject,
        serviceName: string,
    ): Promise<unknown> {
        const actionArguments = {
            session: this.prepareActSessionFromGrpcInput(metadata),
            headers,
            params,
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

        return await this.actionExecutor.execute({
            action,
            tracingMetadata: headers,
            actionArguments,
            transport: RequestMechanism.Grpc,
            spanKind: SpanKind.SERVER,
            serviceName,
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
        }

        return actions
    }

    private prepareActHeadersFromGrpcInput(metadata: Metadata, actVersions: ActionVersion[]): ActHeaders {
        const headers: ActHeaders = { actionVersion: this.getDefaultActionVersion(actVersions), traceId: randomUUID() }

        if (this.hasMetadataProperty(metadata, 'actionversion')) {
            headers.actionVersion = <ActionVersion>metadata.get('actionversion')[0]
        }

        if (this.hasMetadataProperty(metadata, 'traceid')) {
            headers.traceId = <string>metadata.get('traceid')[0]
        }

        if (this.hasMetadataProperty(metadata, 'acceptlanguage')) {
            headers.acceptLanguage = <string>metadata.get('acceptlanguage')[0]
        }

        if (this.hasMetadataProperty(metadata, 'platformtype')) {
            headers.platformType = <PlatformType>metadata.get('platformtype')[0]
        }

        if (this.hasMetadataProperty(metadata, 'mobileuid')) {
            headers.mobileUid = <string>metadata.get('mobileuid')[0]
        }

        if (this.hasMetadataProperty(metadata, 'appversion')) {
            headers.appVersion = <string>metadata.get('appversion')[0]
        }

        if (this.hasMetadataProperty(metadata, 'platformversion')) {
            headers.platformVersion = <string>metadata.get('platformversion')[0]
        }

        if (this.hasMetadataProperty(metadata, 'serviceсode')) {
            headers.serviceCode = <string>metadata.get('serviceсode')[0]
        }

        if (this.hasMetadataProperty(metadata, 'tracing')) {
            headers.tracing = <string>metadata.get('tracing')[0]
        }

        if (this.hasMetadataProperty(metadata, 'traceparent')) {
            headers.traceparent = <string>metadata.get('traceparent')[0]
        }

        if (this.hasMetadataProperty(metadata, 'tracestate')) {
            headers.tracestate = <string>metadata.get('tracestate')[0]
        }

        return headers
    }

    private prepareActSessionFromGrpcInput(metadata: Metadata): ActionSession | undefined {
        if (this.hasMetadataProperty(metadata, 'session')) {
            return JSON.parse(Buffer.from(<string>metadata.get('session')[0], 'base64').toString())
        }

        return undefined
    }

    private hasMetadataProperty(metadata: Metadata, key: string): boolean {
        return metadata.get(key).length > 0
    }

    private getDefaultActionVersion(actVersions: ActionVersion[]): ActionVersion {
        if (actVersions.length > 1) {
            const actVersionsOrder = Object.values(ActionVersion)

            return actVersions.sort((a, b) => actVersionsOrder.indexOf(b) - actVersionsOrder.indexOf(a))[0]
        }

        return actVersions[0]
    }

    private mapApiErrorToRpcError(apiError: ApiError): ServerErrorResponse {
        const errorData = apiError.getData()
        const processCode = errorData.processCode
        const metadata = new Metadata()

        if (processCode) {
            metadata.set('processCode', processCode.toString())
        }

        const rpcErrorCode: number = this.httpCodeToGrpcCode[apiError.getCode()] ?? this.httpCodeToGrpcCode[errorData.code ?? 0]
        const rpcError = { ...new ApiError(apiError.getMessage(), rpcErrorCode, errorData), metadata, code: rpcErrorCode }

        return rpcError
    }
}
