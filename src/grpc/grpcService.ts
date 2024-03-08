import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'

import {
    GrpcObject,
    Metadata,
    MethodDefinition,
    ProtobufTypeDefinition,
    Server,
    ServerCredentials,
    ServerErrorResponse,
    ServerUnaryCall,
    ServiceClientConstructor,
    ServiceDefinition,
    UntypedHandleCall,
    UntypedServiceImplementation,
    loadPackageDefinition,
} from '@grpc/grpc-js'
import { load } from '@grpc/proto-loader'
import { SpanKind } from '@opentelemetry/api'
import { glob } from 'glob'
import { uniq } from 'lodash'
import protobuf from 'protobufjs'

import { MetricsService, RequestMechanism } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { ApiError, HttpError } from '@diia-inhouse/errors'
import { RedlockService } from '@diia-inhouse/redis'
import {
    ActionVersion,
    AlsData,
    GrpcStatusCode,
    HealthCheckResult,
    HttpStatusCode,
    Logger,
    OnHealthCheck,
    OnInit,
    PlatformType,
    PublicServiceCode,
} from '@diia-inhouse/types'
import { ActHeaders, GenericObject } from '@diia-inhouse/types/dist/types/common'
import { OnDestroy } from '@diia-inhouse/types/dist/types/interfaces/onDestroy'
import { ActionSession } from '@diia-inhouse/types/dist/types/session/session'
import { utils } from '@diia-inhouse/utils'
import { AppValidator } from '@diia-inhouse/validators'

import { DiiaActionExecutor } from '../actionExecutor'
import ActionFactory from '../actionFactory'
import { AppAction, GrpcAppAction, GrpcServiceStatus } from '../interfaces'

import wrappers from './wrappers'

export class GrpcService implements OnInit, OnDestroy, OnHealthCheck {
    constructor(
        private readonly envService: EnvService,
        private readonly actionList: AppAction[],
        private readonly logger: Logger,
        validator: AppValidator,
        asyncLocalStorage: AsyncLocalStorage<AlsData>,
        serviceName: string,
        metrics: MetricsService,
        redlock?: RedlockService,
    ) {
        this.actionExecutor = new DiiaActionExecutor(asyncLocalStorage, logger, validator, serviceName, metrics, redlock)

        Object.assign(protobuf.wrappers, wrappers)
    }

    private readonly actionExecutor: DiiaActionExecutor

    private readonly server = new Server()

    private status: GrpcServiceStatus['grpcServer'] = 'UNKNOWN'

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
        return {
            status: this.status === 'SERVING' ? HttpStatusCode.OK : HttpStatusCode.SERVICE_UNAVAILABLE,
            details: { grpcServer: this.status },
        }
    }

    async onInit(): Promise<void> {
        if (!this.envService.getVar('GRPC_SERVER_ENABLED', 'boolean', false)) {
            this.logger.info('grpc server disabled')

            return
        }

        const externalProtos = await glob('node_modules/@diia-inhouse/**/proto/**/*.proto')
        const externalProtosPaths = uniq(externalProtos.map((value) => value.substring(0, value.lastIndexOf('/'))))
        const myProtosDir = 'proto'
        const services = this.envService.getVar<string[]>('GRPC_SERVICES', 'object')
        const myProtos = (await glob(`${myProtosDir}/**/*.proto`)).map((protoPath) =>
            protoPath.slice(protoPath.indexOf(`${myProtosDir}/`) + `${myProtosDir}/`.length),
        )
        const pkgDefs = await load(myProtos, {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
            includeDirs: [...externalProtosPaths, myProtosDir],
        })

        const serviceProto = loadPackageDefinition(pkgDefs)

        services.forEach((service) => {
            const subpath = service.split('.')
            let serviceDefinition: GrpcObject | ServiceClientConstructor | ProtobufTypeDefinition | undefined
            for (const p of subpath) {
                serviceDefinition = serviceDefinition ? (<GrpcObject>serviceDefinition)[p] : serviceProto[p]
            }

            if (!this.isServiceDefinition(serviceDefinition)) {
                throw new Error(`Unable to find service definition for ${service}`)
            }

            this.server.addService(
                serviceDefinition.service,
                this.provideGrpcServiceImplementation(serviceDefinition.serviceName, serviceDefinition.service),
            )
        })

        const grpcPort = this.envService.getVar('GRPC_SERVER_PORT', 'number', 5000)

        this.server.bindAsync(`0.0.0.0:${grpcPort}`, ServerCredentials.createInsecure(), (error, port) => {
            if (error) {
                this.logger.error(`grpc service failed to start on port ${port}`)

                throw new Error(`Unable to start grpc service ${error}`)
            }

            this.server.start()
            this.status = 'SERVING'
            this.logger.info(`grpc service is listening on port ${port}`)
        })
    }

    onDestroy(): Promise<void> {
        this.status = 'NOT_SERVING'

        return new Promise((resolve, reject) => {
            this.server.tryShutdown((err) => (err ? reject(err) : resolve()))
        })
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

                serviceImplementation[grpcMethod] = this.provideGrpcMethodImplementation(
                    serviceName,
                    this.provideAppActions(originalName, method),
                )
            }
        }

        return serviceImplementation
    }

    private provideGrpcMethodImplementation(serviceName: string, actions: Map<ActionVersion, GrpcAppAction>): UntypedHandleCall {
        return async (
            input: ServerUnaryCall<GenericObject, unknown>,
            callback: (err: ServerErrorResponse | null, resp: unknown) => void,
        ) => {
            try {
                const params = input.request

                const headers = this.prepareActHeadersFromGrpcInput(input, Array.from(actions.keys()))

                const actionInstance = actions.get(headers.actionVersion)

                if (!actionInstance) {
                    throw new HttpError('action not found for version ' + headers.actionVersion, HttpStatusCode.NOT_IMPLEMENTED)
                }

                const actionArguments = {
                    session: this.prepareActSessionFromGrpcInput(input),
                    headers,
                    params,
                }

                let tracing: unknown
                if (headers.tracing) {
                    tracing = JSON.parse(headers.tracing)
                }

                const response = await this.actionExecutor.execute(
                    {
                        caller: null,
                        action: {
                            service: {
                                name: serviceName,
                            },
                            name: actionInstance.name,
                            rawName: actionInstance.name,
                        },
                        meta: {
                            tracing: tracing,
                        },
                        params: actionArguments,
                        transport: 'grpc',
                        spanKind: SpanKind.SERVER,
                        msgSystem: RequestMechanism.Grpc,
                    },
                    ActionFactory.getActionValidationRules(actionInstance),
                    actionInstance,
                )

                callback(null, response)
            } catch (error) {
                utils.handleError(error, (apiError) => {
                    callback(this.mapApiErrorToRpcError(apiError), null)
                })
            }
        }
    }

    private provideAppActions(actionName: string, grpcMethod: MethodDefinition<unknown, unknown>): Map<ActionVersion, GrpcAppAction> {
        const actions = new Map<ActionVersion, GrpcAppAction>()
        const actionInstances = this.actionList.filter((action): action is GrpcAppAction => action.name === actionName)
        if (!actionInstances.length) {
            throw new Error(`Unable to find any action for ${actionName}`)
        }

        for (const actionInstance of actionInstances) {
            const actionVersion = actionInstance.actionVersion ?? ActionVersion.V1

            actionInstance.grpcMethod = grpcMethod
            actions.set(actionVersion, actionInstance)
        }

        return actions
    }

    private prepareActHeadersFromGrpcInput(grpcInput: ServerUnaryCall<unknown, unknown>, actVersions: ActionVersion[]): ActHeaders {
        const headers: ActHeaders = { actionVersion: this.getDefaultActionVersion(actVersions), traceId: randomUUID() }

        const { metadata } = grpcInput

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
            headers.serviceCode = <PublicServiceCode>metadata.get('serviceсode')[0]
        }

        if (this.hasMetadataProperty(metadata, 'tracing')) {
            headers.tracing = <string>metadata.get('tracing')[0]
        }

        return headers
    }

    private prepareActSessionFromGrpcInput(grpcInput: ServerUnaryCall<unknown, unknown>): ActionSession | undefined {
        const { metadata } = grpcInput

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

    private isServiceDefinition(
        param: GrpcObject | ServiceClientConstructor | ProtobufTypeDefinition | undefined,
    ): param is ServiceClientConstructor {
        if (param && 'service' in param) {
            return true
        }

        return false
    }
}
