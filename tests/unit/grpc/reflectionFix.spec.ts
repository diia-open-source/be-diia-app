import { PackageDefinition } from '@grpc/proto-loader'
import descriptorExt from 'protobufjs/ext/descriptor'

import { fixReflectionTypeNames } from '../../../src/grpc/reflectionFix'

const { FileDescriptorProto } = descriptorExt

describe('fixReflectionTypeNames', () => {
    it('should fully qualify the type of an extension', () => {
        const buffer = Buffer.from(
            FileDescriptorProto.encode({
                name: 'test.proto',
                package: 'ua.gov.diia.test',
                messageType: [{ name: 'HttpRule' }],
                extension: [{ name: 'http', extendee: '.google.protobuf.MethodOptions', typeName: 'HttpRule' }],
            }).finish(),
        )
        const pkgDef = { 'test.Service': { fileDescriptorProtos: [buffer] } } as unknown as PackageDefinition

        const result = fixReflectionTypeNames(pkgDef)

        const [fixed] = (result['test.Service'] as unknown as { fileDescriptorProtos: Buffer[] }).fileDescriptorProtos
        const [extension] = FileDescriptorProto.decode(fixed).toJSON().extension

        expect(extension.typeName).toBe('.ua.gov.diia.test.HttpRule')
    })
})
