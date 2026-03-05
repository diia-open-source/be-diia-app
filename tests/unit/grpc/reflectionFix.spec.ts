import { PackageDefinition } from '@grpc/proto-loader'
import descriptorExt from 'protobufjs/ext/descriptor'

import { fixReflectionTypeNames } from '../../../src/grpc/reflectionFix'

const { FileDescriptorProto } = descriptorExt

const createFileDescriptor = (options: {
    name: string
    package: string
    messageType?: {
        name: string
        field?: { name: string; typeName?: string }[]
        nestedType?: { name: string; field?: { name: string; typeName?: string }[] }[]
    }[]
    enumType?: { name: string }[]
    service?: {
        name: string
        method?: { name: string; inputType?: string; outputType?: string }[]
    }[]
    extension?: { name: string; extendee?: string; typeName?: string }[]
}): Buffer => {
    const encoded = FileDescriptorProto.encode(options as never).finish()

    return Buffer.from(encoded)
}

const createPackageDefinition = (buffers: Buffer[]): PackageDefinition => {
    const pkgDef: PackageDefinition = {
        ['test.Service']: {
            fileDescriptorProtos: buffers,
        } as never,
    }

    return pkgDef
}

describe('fixReflectionTypeNames', () => {
    describe('returns input unchanged when', () => {
        it('input is null or undefined', () => {
            expect(fixReflectionTypeNames(null as never)).toBeNull()
            expect(fixReflectionTypeNames(undefined as never)).toBeUndefined()
        })

        it('no fixes are needed (types already fully qualified)', () => {
            const buffer = createFileDescriptor({
                name: 'test.proto',
                package: 'ua.gov.diia.test',
                messageType: [
                    {
                        name: 'Request',
                        field: [{ name: 'status', typeName: '.ua.gov.diia.test.Status' }],
                    },
                ],
            })

            const pkgDef = createPackageDefinition([buffer])
            const result = fixReflectionTypeNames(pkgDef)

            expect(result).toBe(pkgDef)
        })

        it('package definition has no fileDescriptorProtos', () => {
            const pkgDef: PackageDefinition = {
                'test.Service': {} as never,
            }

            const result = fixReflectionTypeNames(pkgDef)

            expect(result).toBe(pkgDef)
        })
    })

    describe('fixes unqualified type names in', () => {
        it('message field types', () => {
            const buffer = createFileDescriptor({
                name: 'test.proto',
                package: 'ua.gov.diia.test',
                messageType: [
                    { name: 'Status' },
                    {
                        name: 'Request',
                        field: [{ name: 'status', typeName: 'Status' }],
                    },
                ],
            })

            const pkgDef = createPackageDefinition([buffer])
            const result = fixReflectionTypeNames(pkgDef)

            expect(result).not.toBe(pkgDef)

            const fixedBuffer = (result['test.Service'] as { fileDescriptorProtos: Buffer[] }).fileDescriptorProtos[0]
            const decoded = FileDescriptorProto.decode(fixedBuffer) as {
                messageType?: { name?: string; field?: { typeName?: string }[] }[]
            }
            const requestType = decoded.messageType?.find((m) => m.name === 'Request')

            expect(requestType?.field?.[0]?.typeName).toBe('.ua.gov.diia.test.Status')
        })

        it('service method input and output types', () => {
            const buffer = createFileDescriptor({
                name: 'test.proto',
                package: 'ua.gov.diia.test',
                messageType: [{ name: 'Request' }, { name: 'Response' }],
                service: [
                    {
                        name: 'TestService',
                        method: [
                            {
                                name: 'DoSomething',
                                inputType: 'Request',
                                outputType: 'Response',
                            },
                        ],
                    },
                ],
            })

            const pkgDef = createPackageDefinition([buffer])
            const result = fixReflectionTypeNames(pkgDef)

            const fixedBuffer = (result['test.Service'] as { fileDescriptorProtos: Buffer[] }).fileDescriptorProtos[0]
            const decoded = FileDescriptorProto.decode(fixedBuffer) as {
                service?: { method?: { inputType?: string; outputType?: string }[] }[]
            }
            const method = decoded.service?.[0]?.method?.[0]

            expect(method?.inputType).toBe('.ua.gov.diia.test.Request')
            expect(method?.outputType).toBe('.ua.gov.diia.test.Response')
        })

        it('nested message field types', () => {
            const buffer = createFileDescriptor({
                name: 'test.proto',
                package: 'ua.gov.diia.test',
                messageType: [
                    { name: 'Status' },
                    {
                        name: 'Outer',
                        nestedType: [
                            {
                                name: 'Inner',
                                field: [{ name: 'status', typeName: 'Status' }],
                            },
                        ],
                    },
                ],
            })

            const pkgDef = createPackageDefinition([buffer])
            const result = fixReflectionTypeNames(pkgDef)

            const fixedBuffer = (result['test.Service'] as { fileDescriptorProtos: Buffer[] }).fileDescriptorProtos[0]
            const decoded = FileDescriptorProto.decode(fixedBuffer) as {
                messageType?: { name?: string; nestedType?: { field?: { typeName?: string }[] }[] }[]
            }
            const innerType = decoded.messageType?.find((m) => m.name === 'Outer')?.nestedType?.[0]

            expect(innerType?.field?.[0]?.typeName).toBe('.ua.gov.diia.test.Status')
        })

        it('extension types', () => {
            const buffer = createFileDescriptor({
                name: 'test.proto',
                package: 'ua.gov.diia.test',
                messageType: [{ name: 'Options' }, { name: 'MyExtension' }],
                extension: [
                    {
                        name: 'my_ext',
                        extendee: 'Options',
                        typeName: 'MyExtension',
                    },
                ],
            })

            const pkgDef = createPackageDefinition([buffer])
            const result = fixReflectionTypeNames(pkgDef)

            const fixedBuffer = (result['test.Service'] as { fileDescriptorProtos: Buffer[] }).fileDescriptorProtos[0]
            const decoded = FileDescriptorProto.decode(fixedBuffer) as {
                extension?: { extendee?: string; typeName?: string }[]
            }
            const ext = decoded.extension?.[0]

            expect(ext?.extendee).toBe('.ua.gov.diia.test.Options')
            expect(ext?.typeName).toBe('.ua.gov.diia.test.MyExtension')
        })
    })

    describe('handles package suffix matching', () => {
        it('resolves partial package paths to full package', () => {
            const buffer = createFileDescriptor({
                name: 'test.proto',
                package: 'ua.gov.diia.types.ds.item',
                messageType: [
                    { name: 'DSItem' },
                    {
                        name: 'Request',
                        field: [{ name: 'item', typeName: 'types.ds.item.DSItem' }],
                    },
                ],
            })

            const pkgDef = createPackageDefinition([buffer])
            const result = fixReflectionTypeNames(pkgDef)

            const fixedBuffer = (result['test.Service'] as { fileDescriptorProtos: Buffer[] }).fileDescriptorProtos[0]
            const decoded = FileDescriptorProto.decode(fixedBuffer) as {
                messageType?: { name?: string; field?: { typeName?: string }[] }[]
            }
            const requestType = decoded.messageType?.find((m) => m.name === 'Request')

            expect(requestType?.field?.[0]?.typeName).toBe('.ua.gov.diia.types.ds.item.DSItem')
        })
    })

    describe('handles multiple file descriptors', () => {
        it('processes all unique buffers once', () => {
            const buffer1 = createFileDescriptor({
                name: 'types.proto',
                package: 'ua.gov.diia.types',
                messageType: [{ name: 'CommonType' }],
            })

            const buffer2 = createFileDescriptor({
                name: 'service.proto',
                package: 'ua.gov.diia.service',
                messageType: [
                    {
                        name: 'Request',
                        field: [{ name: 'common', typeName: 'types.CommonType' }],
                    },
                ],
            })

            const pkgDef: PackageDefinition = {
                'service.Service': {
                    fileDescriptorProtos: [buffer1, buffer2],
                } as never,
            }

            const result = fixReflectionTypeNames(pkgDef)

            expect(result).not.toBe(pkgDef)
        })

        it('shares fixed buffers across multiple definitions', () => {
            const sharedBuffer = createFileDescriptor({
                name: 'shared.proto',
                package: 'ua.gov.diia.shared',
                messageType: [
                    {
                        name: 'Request',
                        field: [{ name: 'status', typeName: 'Status' }],
                    },
                    { name: 'Status' },
                ],
            })

            const pkgDef: PackageDefinition = {
                'service1.Service': {
                    fileDescriptorProtos: [sharedBuffer],
                } as never,
                'service2.Service': {
                    fileDescriptorProtos: [sharedBuffer],
                } as never,
            }

            const result = fixReflectionTypeNames(pkgDef)

            const buf1 = (result['service1.Service'] as { fileDescriptorProtos: Buffer[] }).fileDescriptorProtos[0]
            const buf2 = (result['service2.Service'] as { fileDescriptorProtos: Buffer[] }).fileDescriptorProtos[0]

            expect(buf1).toBe(buf2)
        })
    })
})
