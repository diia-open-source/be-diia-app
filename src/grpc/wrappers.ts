import { IWrapper, Message, Type } from 'protobufjs'

import { GenericObject } from '@diia-inhouse/types/dist/types/common'

export default {
    '.google.protobuf.Timestamp': <IWrapper>{
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

            if (isNaN(dt)) {
                return this.fromObject(object)
            }

            return (<Type>this).create({
                seconds: Math.floor(dt / 1000),
                nanos: (dt % 1000) * 1000000,
            })
        },
        toObject(message: GenericObject): GenericObject {
            return new Date(message.seconds * 1000 + message.nanos / 1000000)
        },
    },
}
