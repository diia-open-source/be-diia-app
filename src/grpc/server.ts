import path from 'node:path'

import {
    GrpcObject,
    ProtobufTypeDefinition,
    Server,
    ServerCredentials,
    ServiceClientConstructor,
    loadPackageDefinition,
} from '@grpc/grpc-js'
import { PackageDefinition, load } from '@grpc/proto-loader'
import { ReflectionService } from '@grpc/reflection'
import { glob } from 'glob'

import { GrpcHealthCheckImplementation, HealthCheck, protoPath as healthProtoPath } from '@diia-inhouse/healthcheck'
import type { Logger } from '@diia-inhouse/types'

import { GrpcServerConfig, GrpcServiceImplementationProvider, GrpcServiceStatus } from '../interfaces/grpc'
import { fixReflectionTypeNames } from './reflectionFix'
import {
    GrpcSchemaService,
    PROTO_LOADER_OPTIONS,
    SchemaReflectionInitializer,
    SchemaRegistry,
    schemaReflectionProtoPath,
} from './schemaReflection'

export class GrpcServer {
    health: GrpcHealthCheckImplementation | undefined

    readonly schemaRegistry: SchemaRegistry | undefined

    private status: GrpcServiceStatus['grpcServer'] = 'UNKNOWN'

    private readonly server: Server

    constructor(
        private readonly config: GrpcServerConfig,
        private readonly logger: Logger,
        private readonly healthCheck: HealthCheck | undefined,
        private readonly serviceName = '',
        private readonly version = '',
    ) {
        const keepAliveSettings = {
            'grpc.keepalive_time_ms': this.config.keepAlive?.interval || 15000,
            'grpc.keepalive_timeout_ms': this.config.keepAlive?.timeout || 10000,
            'grpc.keepalive_permit_without_calls': this.config.keepAlive?.permitWithoutcalls || 1,
        }

        this.server = new Server({
            'grpc.max_receive_message_length': this.config.maxReceiveMessageLength,
            ...keepAliveSettings,
        })

        if (this.healthCheck) {
            this.health = new GrpcHealthCheckImplementation(this.healthCheck)
        }

        if (this.config.isReflectionEnabled) {
            this.schemaRegistry = new SchemaRegistry()
        }
    }

    getStatus(): GrpcServiceStatus['grpcServer'] {
        return this.status
    }

    async start(grpcServiceImplementationProvider: GrpcServiceImplementationProvider): Promise<number> {
        const externalProtos = await glob('node_modules/@diia-inhouse/**/proto/**/*.proto', {
            ignore: ['node_modules/@diia-inhouse/*/node_modules/**'],
        })
        const externalProtosRootDirs = new Set(
            externalProtos.map((value) => {
                const protoIndex = value.indexOf('/proto/')

                return protoIndex === -1 ? path.dirname(value) : value.slice(0, Math.max(0, protoIndex + '/proto'.length))
            }),
        )

        const internalProtosDirname = 'proto'
        const internalProtosPaths = await glob(`${internalProtosDirname}/**/*.proto`)
        const internalProtos = internalProtosPaths.map((protoPath) => path.relative(internalProtosDirname, protoPath))
        const protosToLoad = [...internalProtos]
        if (this.healthCheck) {
            protosToLoad.push(healthProtoPath)
        }

        if (this.schemaRegistry) {
            protosToLoad.push(schemaReflectionProtoPath)
        }

        const includeDirs = [...externalProtosRootDirs, internalProtosDirname]
        const pkgDefs = await load(protosToLoad, {
            ...PROTO_LOADER_OPTIONS,
            includeDirs,
        })

        this.logger.debug('grpc server proto loaded', { pkgDefs })
        const serviceProto = loadPackageDefinition(pkgDefs)

        if (this.health) {
            this.health.addToServer(this.server)
        }

        await this.initReflection(pkgDefs, serviceProto, internalProtos, includeDirs)

        for (const service of this.config.services) {
            const subpath = service.split('.')
            let serviceDefinition: GrpcObject | ServiceClientConstructor | ProtobufTypeDefinition | undefined
            for (const p of subpath) {
                serviceDefinition = serviceDefinition ? (serviceDefinition as GrpcObject)[p] : serviceProto[p]
            }

            if (!this.isServiceDefinition(serviceDefinition)) {
                throw new Error(`Unable to find service definition for ${service}`)
            }

            this.logger.debug('grpc server service definition', {
                service: serviceDefinition.service,
                serviceName: serviceDefinition.serviceName,
            })
            this.server.addService(serviceDefinition.service, grpcServiceImplementationProvider(serviceDefinition.service))
        }

        const { promise, resolve, reject } = Promise.withResolvers<number>()

        this.server.bindAsync(`0.0.0.0:${this.config.port}`, ServerCredentials.createInsecure(), (error, port) => {
            if (error) {
                this.logger.error(`grpc service failed to start on port ${port}`)

                return reject(error)
            }

            this.status = 'SERVING'

            this.logger.info(`grpc service is listening on port ${port}`)
            resolve(port)
        })

        return await promise
    }

    async stop(): Promise<void> {
        this.status = 'NOT_SERVING'

        return await new Promise((resolve, reject) => {
            this.server.tryShutdown((err) => (err ? reject(err) : resolve(this.server.forceShutdown())))
        })
    }

    private isServiceDefinition(
        param: GrpcObject | ServiceClientConstructor | ProtobufTypeDefinition | undefined,
    ): param is ServiceClientConstructor {
        if (param && 'service' in param) {
            return true
        }

        return false
    }

    private async initReflection(
        pkgDefs: PackageDefinition,
        serviceProto: GrpcObject,
        internalProtos: string[],
        includeDirs: string[],
    ): Promise<void> {
        if (!this.schemaRegistry) {
            return
        }

        const fixedPkgDefs = fixReflectionTypeNames(pkgDefs)
        const reflection = new ReflectionService(fixedPkgDefs)

        reflection.addToServer(this.server)

        await SchemaReflectionInitializer.initialize(internalProtos, includeDirs, pkgDefs, this.schemaRegistry, this.logger)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schemaReflectionService = (serviceProto.diia as any)?.schema?.v1?.SchemaReflection?.service
        if (!schemaReflectionService) {
            this.logger.warn('SchemaReflection service definition not found in proto')

            return
        }

        const schemaService = new GrpcSchemaService(this.serviceName, this.version, this.schemaRegistry)

        schemaService.addToServer(this.server, schemaReflectionService)
    }
}
