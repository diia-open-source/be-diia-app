import path from 'node:path'

import {
    GrpcObject,
    ProtobufTypeDefinition,
    Server,
    ServerCredentials,
    ServiceClientConstructor,
    loadPackageDefinition,
} from '@grpc/grpc-js'
import { load } from '@grpc/proto-loader'
import { ReflectionService } from '@grpc/reflection'
import { glob } from 'glob'

import type { Logger } from '@diia-inhouse/types'

import { GrpcServerConfig, GrpcServiceImplementationProvider, GrpcServiceStatus } from '../interfaces/grpc'

export class GrpcServer {
    constructor(
        private readonly config: GrpcServerConfig,
        private readonly logger: Logger,
    ) {
        this.server = new Server({ 'grpc.max_receive_message_length': this.config.maxReceiveMessageLength })
    }

    private status: GrpcServiceStatus['grpcServer'] = 'UNKNOWN'

    private readonly server: Server

    getStatus(): GrpcServiceStatus['grpcServer'] {
        return this.status
    }

    async start(grpcServiceImplementationProvider: GrpcServiceImplementationProvider): Promise<void> {
        const externalProtos = await glob('node_modules/@diia-inhouse/**/proto/**/*.proto')
        const externalProtosDirnames = new Set(externalProtos.map((value) => path.dirname(value)))

        const internalProtosDirname = 'proto'
        const internalProtosPaths = await glob(`${internalProtosDirname}/**/*.proto`)
        const internalProtos = internalProtosPaths.map((protoPath) => path.relative(internalProtosDirname, protoPath))
        const pkgDefs = await load(internalProtos, {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
            includeDirs: [...externalProtosDirnames, internalProtosDirname],
        })

        this.logger.debug('grpc server proto loaded', { pkgDefs })
        const serviceProto = loadPackageDefinition(pkgDefs)
        if (this.config.isReflectionEnabled) {
            const reflection = new ReflectionService(pkgDefs)

            reflection.addToServer(this.server)
        }

        for (const service of this.config.services) {
            const subpath = service.split('.')
            let serviceDefinition: GrpcObject | ServiceClientConstructor | ProtobufTypeDefinition | undefined
            for (const p of subpath) {
                serviceDefinition = serviceDefinition ? (<GrpcObject>serviceDefinition)[p] : serviceProto[p]
            }

            if (!this.isServiceDefinition(serviceDefinition)) {
                throw new Error(`Unable to find service definition for ${service}`)
            }

            this.logger.debug('grpc server service definition', {
                service: serviceDefinition.service,
                serviceName: serviceDefinition.serviceName,
            })
            this.server.addService(
                serviceDefinition.service,
                grpcServiceImplementationProvider(serviceDefinition.serviceName, serviceDefinition.service),
            )
        }

        return await new Promise((resolve, reject) => {
            this.server.bindAsync(`0.0.0.0:${this.config.port}`, ServerCredentials.createInsecure(), (error, port) => {
                if (error) {
                    this.logger.error(`grpc service failed to start on port ${port}`)

                    return reject(error)
                }

                this.status = 'SERVING'
                this.logger.info(`grpc service is listening on port ${port}`)
                resolve()
            })
        })
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
}
