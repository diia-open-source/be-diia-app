import { AnyDefinition, PackageDefinition } from '@grpc/proto-loader'
import lodash from 'lodash'
import descriptorExt from 'protobufjs/ext/descriptor/index.js'

const { FileDescriptorProto } = descriptorExt

interface FieldDescriptor {
    [key: string]: unknown
    name: string
    typeName?: string
}

interface MessageDescriptor {
    [key: string]: unknown
    name: string
    field?: FieldDescriptor[]
    nestedType?: MessageDescriptor[]
    enumType?: { name?: string }[]
    options?: { mapEntry?: boolean }
}

interface ExtensionDescriptor {
    [key: string]: unknown
    name: string
    typeName?: string
}

interface FileDescriptor {
    [key: string]: unknown
    name: string
    package: string
    dependency?: string[]
    messageType?: MessageDescriptor[]
    enumType?: { name?: string }[]
    extension?: ExtensionDescriptor[]
    service?: {
        [key: string]: unknown
        name: string
        method?: {
            [key: string]: unknown
            name: string
            inputType?: string
            outputType?: string
        }[]
    }[]
}

/**
 * Fixes the file descriptors in a PackageDefinition to use fully-qualified type names.
 *
 * This works around a bug in @grpc/proto-loader where type names in file descriptors
 * are not fully qualified (missing leading dot), causing reflection clients like grpcurl
 * to fail with errors like "cannot resolve type: *.types.ds.item.DSTopGroupItem not found".
 *
 * @see https://github.com/grpc/grpc-node/issues/2958
 */
export function fixReflectionTypeNames(pkgDefs: PackageDefinition): PackageDefinition {
    // Decode all buffers once and store them
    const decodedDescriptors = new Map<Buffer, FileDescriptor>()

    for (const def of Object.values(pkgDefs)) {
        if (def && 'fileDescriptorProtos' in def && Array.isArray(def.fileDescriptorProtos)) {
            for (const buf of def.fileDescriptorProtos) {
                if (buf instanceof Buffer && !decodedDescriptors.has(buf)) {
                    decodedDescriptors.set(buf, FileDescriptorProto.decode(buf) as unknown as FileDescriptor)
                }
            }
        }
    }

    const modified = new Set<FileDescriptor>()

    for (const fd of decodedDescriptors.values()) {
        forEachMessage(fd.messageType, fd.package, (mt) => {
            if (fixMapEntryNames(mt)) {
                modified.add(fd)
            }
        })
    }

    const typeNames = collectTypeNames(decodedDescriptors.values())

    for (const fd of decodedDescriptors.values()) {
        if (qualifyTypeNames(fd, typeNames)) {
            modified.add(fd)
        }
    }

    const fixedBuffers = new Map<Buffer, Buffer>()

    for (const [buf, fd] of decodedDescriptors) {
        if (modified.has(fd)) {
            fixedBuffers.set(buf, Buffer.from(FileDescriptorProto.encode(fd).finish()))
        }
    }

    if (fixedBuffers.size === 0) {
        return pkgDefs
    }

    // Create new pkgDefs with fixed buffers
    const fixedPkgDefs: PackageDefinition = {}

    for (const [key, def] of Object.entries(pkgDefs)) {
        if (def && 'fileDescriptorProtos' in def && Array.isArray(def.fileDescriptorProtos)) {
            const fixedProtos = def.fileDescriptorProtos.map((buf: Buffer) => fixedBuffers.get(buf) || buf)

            fixedPkgDefs[key] = {
                ...def,
                fileDescriptorProtos: fixedProtos,
            } as AnyDefinition
        } else {
            fixedPkgDefs[key] = def
        }
    }

    return fixedPkgDefs
}

/** ReflectionService's `services` option filters only list_services; symbol lookups would still describe every service */
export function keepReflectionServices(pkgDefs: PackageDefinition, services: string[]): PackageDefinition {
    const filtered = new Map<Buffer, Buffer>()
    const filter = (buf: Buffer): Buffer => {
        const cached = filtered.get(buf)
        if (cached) {
            return cached
        }

        const fd = FileDescriptorProto.decode(buf) as unknown as FileDescriptor

        fd.service = fd.service?.filter(({ name }) => services.includes(fd.package ? `${fd.package}.${name}` : name))
        const result = Buffer.from(FileDescriptorProto.encode(fd).finish())

        filtered.set(buf, result)

        return result
    }

    return Object.fromEntries(
        Object.entries(pkgDefs).map(([key, def]) => [
            key,
            'fileDescriptorProtos' in def && Array.isArray(def.fileDescriptorProtos)
                ? { ...def, fileDescriptorProtos: def.fileDescriptorProtos.map(filter) }
                : def,
        ]),
    ) as PackageDefinition
}

function joinName(scope: string, name: string): string {
    return scope ? `${scope}.${name}` : name
}

function parentScope(fullName: string): string {
    return fullName.slice(0, Math.max(0, fullName.lastIndexOf('.')))
}

function forEachMessage(
    messages: MessageDescriptor[] | undefined,
    scope: string,
    visit: (message: MessageDescriptor, fullName: string) => void,
): void {
    for (const message of messages ?? []) {
        const fullName = joinName(scope, message.name)

        visit(message, fullName)
        forEachMessage(message.nestedType, fullName, visit)
    }
}

function collectTypeNames(files: Iterable<FileDescriptor>): Set<string> {
    const typeNames = new Set<string>()

    for (const fd of files) {
        for (const { name = '' } of fd.enumType ?? []) {
            typeNames.add(joinName(fd.package, name))
        }

        forEachMessage(fd.messageType, fd.package, (mt, fullName) => {
            typeNames.add(fullName)
            for (const { name = '' } of mt.enumType ?? []) {
                typeNames.add(joinName(fullName, name))
            }
        })
    }

    return typeNames
}

function qualifyTypeNames(fd: FileDescriptor, typeNames: Set<string>): boolean {
    let modified = false
    const qualify = (ref: { typeName?: string }, scope: string): void => {
        if (!ref.typeName || ref.typeName.startsWith('.')) {
            return
        }

        const resolved = resolveTypeName(ref.typeName, scope, typeNames)
        if (resolved) {
            ref.typeName = resolved
            modified = true
        }
    }

    forEachMessage(fd.messageType, fd.package, (mt, fullName) => {
        // protobufjs names a map value relative to the parent of the message that declares the map
        const scope = mt.options?.mapEntry ? parentScope(parentScope(fullName)) : fullName

        for (const field of mt.field ?? []) {
            // A map keeps the bare name of its entry: gateways on earlier diia-app releases find the entry only by that name
            if (!mt.nestedType?.some(({ name, options }) => options?.mapEntry && name === field.typeName)) {
                qualify(field, scope)
            }
        }
    })

    // Fix extension types
    for (const ext of fd.extension ?? []) {
        qualify(ext, fd.package)
    }

    return modified
}

/**
 * The innermost enclosing scope that defines the whole name wins. That is protoc's answer whenever protoc accepts
 * the name, and protobufjs's when a closer scope defines only its first part, e.g. `icon.Icon` inside `ds.atoms`.
 */
function resolveTypeName(typeName: string, scope: string, typeNames: Set<string>): string | undefined {
    const scopeParts = scope ? scope.split('.') : []

    for (let depth = scopeParts.length; depth >= 0; depth--) {
        const candidate = joinName(scopeParts.slice(0, depth).join('.'), typeName)
        if (typeNames.has(candidate)) {
            return `.${candidate}`
        }
    }

    return undefined
}

/** protobufjs emits `ucFirst(fieldName)`; protobuf requires `<CamelCasedFieldName>Entry`. */
function fixMapEntryNames(mt: MessageDescriptor): boolean {
    if (!mt.field || !mt.nestedType) {
        return false
    }

    let modified = false

    for (const field of mt.field) {
        if (!field.typeName) {
            continue
        }

        const simpleName = field.typeName.split('.').pop()
        const entry = mt.nestedType.find((nested) => nested.name === simpleName && nested.options?.mapEntry)

        if (!entry) {
            continue
        }

        const expectedName = `${field.name
            .split('_')
            .map((part) => lodash.upperFirst(part))
            .join('')}Entry`

        if (entry.name !== expectedName) {
            entry.name = expectedName
            field.typeName = field.typeName.replace(/[^.]+$/, expectedName)
            modified = true
        }
    }

    return modified
}
