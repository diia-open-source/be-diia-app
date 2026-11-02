import path from 'node:path'

import {
    ChannelOptions,
    GrpcObject,
    ProtobufTypeDefinition,
    Server,
    ServerCredentials,
    ServiceClientConstructor,
    UntypedServiceImplementation,
    loadPackageDefinition,
} from '@grpc/grpc-js'
import { PackageDefinition, load } from '@grpc/proto-loader'
import { ReflectionService } from '@grpc/reflection'
import { glob } from 'glob'

import type { EnvService } from '@diia-inhouse/env'
import { GrpcHealthCheckImplementation, HealthCheck, protoPath as healthProtoPath } from '@diia-inhouse/healthcheck'
import type { Logger } from '@diia-inhouse/types'

import { GrpcServerConfig, GrpcServiceImplementationProvider, GrpcServiceStatus } from '../interfaces/grpc.js'
import { fixReflectionTypeNames, keepReflectionServices } from './reflectionFix.js'
import {
    GrpcSchemaService,
    PROTO_LOADER_OPTIONS,
    SchemaReflectionInitializer,
    SchemaRegistry,
    schemaReflectionProtoPath,
} from './schemaReflection/index.js'
import { groupServicesByPort } from './servicePorts.js'

export class GrpcServer {
    health: GrpcHealthCheckImplementation | undefined

    readonly schemaRegistry: SchemaRegistry | undefined

    private status: GrpcServiceStatus['grpcServer'] = 'UNKNOWN'

    private readonly serverOptions: ChannelOptions

    private servers: Server[] = []

    constructor(
        private readonly config: GrpcServerConfig,
        private readonly logger: Logger,
        private readonly envService: EnvService,
        private readonly healthCheck: HealthCheck | undefined,
        private readonly serviceName = '',
        private readonly version = '',
    ) {
        const keepAliveSettings = {
            'grpc.keepalive_time_ms': this.config.keepAlive?.interval || 15000,
            'grpc.keepalive_timeout_ms': this.config.keepAlive?.timeout || 10000,
            'grpc.keepalive_permit_without_calls': this.config.keepAlive?.permitWithoutcalls || 1,
        }

        this.serverOptions = {
            'grpc.max_receive_message_length': this.config.maxReceiveMessageLength,
            ...keepAliveSettings,
        }

        if (this.healthCheck) {
            this.health = new GrpcHealthCheckImplementation(this.healthCheck)
        }

        if (this.config.isReflectionEnabled && !this.envService.isProd()) {
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

        const includeDirs = [...externalProtosRootDirs, internalProtosDirname, ...PROTO_LOADER_OPTIONS.includeDirs]
        const pkgDefs = await load(protosToLoad, {
            ...PROTO_LOADER_OPTIONS,
            includeDirs,
        })

        this.logger.debug('grpc server proto loaded', { pkgDefs })
        const serviceProto = loadPackageDefinition(pkgDefs)

        const servicesByPort = groupServicesByPort(this.config.services, this.config.port)
        const implementations = new Map<string, UntypedServiceImplementation>()
        const servers = new Map<number, Server>()

        for (const [port, services] of servicesByPort) {
            const server = new Server(this.serverOptions)

            if (this.health) {
                this.health.addToServer(server)
            }

            const reflectedServices = this.health ? [...services, 'grpc.health.v1.Health'] : services
            const portServices = port === this.config.port ? undefined : reflectedServices

            await this.initReflection(server, portServices, pkgDefs, serviceProto, internalProtos, includeDirs)

            for (const service of services) {
                const serviceDefinition = this.findServiceDefinition(serviceProto, service)
                const implementation = implementations.get(service) ?? grpcServiceImplementationProvider(serviceDefinition.service)

                implementations.set(service, implementation)
                server.addService(serviceDefinition.service, implementation)
            }

            servers.set(port, server)
        }

        const [defaultPort] = await this.bindAll(servers)

        this.servers = Array.from(servers.values())
        this.status = 'SERVING'

        return defaultPort
    }

    async stop(): Promise<void> {
        this.status = 'NOT_SERVING'

        await Promise.all(
            this.servers.map(
                (server) =>
                    new Promise<void>((resolve, reject) => {
                        server.tryShutdown((err) => {
                            if (err) {
                                reject(err)

                                return
                            }

                            resolve(server.forceShutdown())
                        })
                    }),
            ),
        )
    }

    async preStop(): Promise<void> {
        this.status = 'NOT_SERVING'
    }

    private async bindAll(servers: Map<number, Server>): Promise<number[]> {
        const binds = Array.from(servers, ([port, server]) => this.bind(server, port))
        const results = await Promise.allSettled(binds)
        const failure = results.find((result) => result.status === 'rejected')
        if (failure) {
            for (const server of servers.values()) {
                server.forceShutdown()
            }

            throw failure.reason
        }

        return await Promise.all(binds)
    }

    private async bind(server: Server, port: number): Promise<number> {
        const { promise, resolve, reject } = Promise.withResolvers<number>()

        server.bindAsync(`0.0.0.0:${port}`, ServerCredentials.createInsecure(), (error, boundPort) => {
            if (error) {
                this.logger.error(`grpc service failed to start on port ${port}`)

                return reject(error)
            }

            this.logger.info(`grpc service is listening on port ${boundPort}`)
            resolve(boundPort)
        })

        return await promise
    }

    private findServiceDefinition(serviceProto: GrpcObject, service: string): ServiceClientConstructor {
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

        return serviceDefinition
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
        server: Server,
        portServices: string[] | undefined,
        pkgDefs: PackageDefinition,
        serviceProto: GrpcObject,
        internalProtos: string[],
        includeDirs: string[],
    ): Promise<void> {
        if (!this.schemaRegistry) {
            return
        }

        const conformantPkgDefs = fixReflectionTypeNames(pkgDefs)
        if (portServices) {
            new ReflectionService(keepReflectionServices(conformantPkgDefs, portServices)).addToServer(server)

            return
        }

        const reflection = new ReflectionService(conformantPkgDefs)

        reflection.addToServer(server)

        await SchemaReflectionInitializer.initialize(internalProtos, includeDirs, conformantPkgDefs, this.schemaRegistry, this.logger)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schemaReflectionService = (serviceProto.diia as any)?.schema?.v1?.SchemaReflection?.service
        if (!schemaReflectionService) {
            this.logger.warn('SchemaReflection service definition not found in proto')

            return
        }

        const schemaService = new GrpcSchemaService(this.serviceName, this.version, this.schemaRegistry)

        schemaService.addToServer(server, schemaReflectionService)
    }
}
