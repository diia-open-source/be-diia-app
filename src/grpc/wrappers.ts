import { createRequire } from 'node:module'

import protobuf, { IWrapper, Message, Type } from 'protobufjs'

import { Logger } from '@diia-inhouse/types'
import { GenericObject } from '@diia-inhouse/types/dist/types/common'

const wrappers = {
    '.google.protobuf.Timestamp': {
        fromObject(object: { [k: string]: unknown }): Message {
            if (typeof object !== 'string') {
                if (object instanceof Date) {
                    return this.fromObject({
                        seconds: Math.floor(object.getTime() / 1000),
                        nanos: (object.getTime() % 1000) * 1000000,
                    })
                }

                return this.fromObject(object)
            }

            const dt = Date.parse(object)

            if (Number.isNaN(dt)) {
                return this.fromObject(object)
            }

            return (this as Type).create({
                seconds: Math.floor(dt / 1000),
                nanos: (dt % 1000) * 1000000,
            })
        },
        toObject(message: GenericObject): GenericObject {
            return new Date(message.seconds * 1000 + message.nanos / 1000000)
        },
    } as IWrapper,
}

export default wrappers

/**
 * Registers Timestamp wrappers on all discoverable protobufjs instances.
 *
 * When a service resolves multiple protobufjs versions (e.g. diia-app pins 7.2.5
 * but the service root has 7.5.4), `@grpc/proto-loader` may use a different
 * instance than the one diia-app imports directly. Without registering the
 * wrapper on proto-loader's instance, Timestamp fields serialize as
 * {seconds: 0, nanos: 0} (Unix epoch) because protobufjs doesn't know how
 * to convert Date objects.
 */
export function registerWrappers(logger: Logger): void {
    Object.assign(protobuf.wrappers, wrappers)

    // __filename in CJS; replace with import.meta.url when migrating to ESM
    const localRequire = createRequire(__filename)

    let protoLoaderPath: string
    try {
        protoLoaderPath = localRequire.resolve('@grpc/proto-loader')
    } catch {
        logger?.info('@grpc/proto-loader not installed, skipping proto-loader protobufjs wrapper registration')

        return
    }

    const protoLoaderRequire = createRequire(protoLoaderPath)
    const protoLoaderProtobuf = protoLoaderRequire('protobufjs')

    if (protoLoaderProtobuf !== protobuf) {
        Object.assign(protoLoaderProtobuf.wrappers, wrappers)
    }
}
