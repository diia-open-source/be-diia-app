import { AnyDefinition, PackageDefinition } from '@grpc/proto-loader'
import descriptorExt from 'protobufjs/ext/descriptor'

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
}

interface ExtensionDescriptor {
    [key: string]: unknown
    name: string
    extendee?: string
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
    if (!pkgDefs) {
        return pkgDefs
    }

    // Decode all buffers once and store them
    const decodedDescriptors = new Map<Buffer, FileDescriptor>()
    // Map package suffix to all full package names with that suffix
    const packageMap = new Map<string, string[]>()
    // Map simple type name to all FQNs with that name
    const typeMap = new Map<string, string[]>()

    // Collect unique buffers and decode each one once
    for (const def of Object.values(pkgDefs)) {
        if (def && 'fileDescriptorProtos' in def && Array.isArray(def.fileDescriptorProtos)) {
            for (const buf of def.fileDescriptorProtos) {
                if (buf instanceof Buffer && !decodedDescriptors.has(buf)) {
                    const fd = FileDescriptorProto.decode(buf) as unknown as FileDescriptor

                    decodedDescriptors.set(buf, fd)

                    if (fd.package) {
                        buildPackageMap(fd.package, packageMap)
                        collectTypes(fd, typeMap)
                    }
                }
            }
        }
    }

    // Apply fixes to decoded descriptors
    const fixedBuffers = new Map<Buffer, Buffer>()

    for (const [buf, fd] of decodedDescriptors) {
        const modified = applyFixes(fd, packageMap, typeMap)

        if (modified) {
            const encoded = FileDescriptorProto.encode(fd as never).finish()

            fixedBuffers.set(buf, Buffer.from(encoded))
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

function buildPackageMap(packageName: string, packageMap: Map<string, string[]>): void {
    // Map short package suffix to all full packages that have that suffix
    // e.g., "icon" -> ["ua.gov.diia.types.ds.icon", "ua.gov.diia.types.ds.atoms.icon"]
    const parts = packageName.split('.')
    for (let i = 1; i < parts.length; i++) {
        const suffix = parts.slice(i).join('.')
        const existing = packageMap.get(suffix)
        if (existing) {
            if (!existing.includes(packageName)) {
                existing.push(packageName)
            }
        } else {
            packageMap.set(suffix, [packageName])
        }
    }
}

function collectTypes(fd: FileDescriptor, typeMap: Map<string, string[]>): void {
    const packagePrefix = '.' + fd.package + '.'

    // Collect message types recursively
    if (fd.messageType) {
        for (const msg of fd.messageType) {
            collectMessageTypes(msg, packagePrefix, typeMap)
        }
    }

    // Collect enum types
    if (fd.enumType) {
        for (const e of fd.enumType) {
            if (e.name) {
                addToTypeMap(typeMap, e.name, packagePrefix + e.name)
            }
        }
    }
}

function collectMessageTypes(msg: MessageDescriptor, prefix: string, typeMap: Map<string, string[]>): void {
    if (msg.name) {
        addToTypeMap(typeMap, msg.name, prefix + msg.name)
    }

    // Recursively collect nested types
    if (msg.nestedType) {
        const nestedPrefix = prefix + msg.name + '.'
        for (const nested of msg.nestedType) {
            collectMessageTypes(nested, nestedPrefix, typeMap)
        }
    }
}

function addToTypeMap(typeMap: Map<string, string[]>, simpleName: string, fqn: string): void {
    const existing = typeMap.get(simpleName)
    if (existing) {
        if (!existing.includes(fqn)) {
            existing.push(fqn)
        }
    } else {
        typeMap.set(simpleName, [fqn])
    }
}

function applyFixes(fd: FileDescriptor, packageMap: Map<string, string[]>, typeMap: Map<string, string[]>): boolean {
    let modified = false

    // Fix message type names
    if (fd.messageType) {
        for (const mt of fd.messageType) {
            if (fixMessageTypeNames(mt, packageMap, typeMap)) {
                modified = true
            }
        }
    }

    // Fix service method input/output types
    if (fd.service) {
        for (const svc of fd.service) {
            if (svc.method) {
                for (const method of svc.method) {
                    if (method.inputType && !method.inputType.startsWith('.')) {
                        const fixed = fullyQualifyTypeName(method.inputType, packageMap, typeMap)
                        if (fixed !== method.inputType) {
                            method.inputType = fixed
                            modified = true
                        }
                    }

                    if (method.outputType && !method.outputType.startsWith('.')) {
                        const fixed = fullyQualifyTypeName(method.outputType, packageMap, typeMap)
                        if (fixed !== method.outputType) {
                            method.outputType = fixed
                            modified = true
                        }
                    }
                }
            }
        }
    }

    // Fix extensions (extendee and typeName)
    if (fd.extension) {
        for (const ext of fd.extension) {
            if (ext.extendee && !ext.extendee.startsWith('.')) {
                const fixed = fullyQualifyTypeName(ext.extendee, packageMap, typeMap)
                if (fixed !== ext.extendee) {
                    ext.extendee = fixed
                    modified = true
                }
            }

            if (ext.typeName && !ext.typeName.startsWith('.')) {
                const fixed = fullyQualifyTypeName(ext.typeName, packageMap, typeMap)
                if (fixed !== ext.typeName) {
                    ext.typeName = fixed
                    modified = true
                }
            }
        }
    }

    return modified
}

function fixMessageTypeNames(mt: MessageDescriptor, packageMap: Map<string, string[]>, typeMap: Map<string, string[]>): boolean {
    let modified = false

    if (mt.field) {
        for (const field of mt.field) {
            if (field.typeName && !field.typeName.startsWith('.')) {
                const fixed = fullyQualifyTypeName(field.typeName, packageMap, typeMap)
                if (fixed !== field.typeName) {
                    field.typeName = fixed
                    modified = true
                }
            }
        }
    }

    if (mt.nestedType) {
        for (const nested of mt.nestedType) {
            if (fixMessageTypeNames(nested, packageMap, typeMap)) {
                modified = true
            }
        }
    }

    return modified
}

function fullyQualifyTypeName(typeName: string, packageMap: Map<string, string[]>, typeMap: Map<string, string[]>): string {
    if (typeName.startsWith('.')) {
        return typeName
    }

    const parts = typeName.split('.')

    // Simple name without dots (like "PaddingMode") - look up in type map
    if (parts.length === 1) {
        const fqns = typeMap.get(typeName)
        if (fqns && fqns.length === 1) {
            // Only use typeMap if there's exactly one FQN (unambiguous)
            return fqns[0]
        }

        // For ambiguous simple names, leave as-is (proto-loader will resolve based on context)
        return typeName
    }

    const messageName = parts.at(-1)

    // Try to find matching package from longest to shortest suffix
    for (let i = 0; i < parts.length - 1; i++) {
        const pkgSuffix = parts.slice(i, -1).join('.')
        const fullPkgs = packageMap.get(pkgSuffix)
        if (fullPkgs) {
            // Try each package and verify the type exists
            for (const fullPkg of fullPkgs) {
                const candidate = '.' + fullPkg + '.' + messageName
                if (isKnownType(candidate, typeMap)) {
                    return candidate
                }
            }

            // If no verified match, use the first package (fallback behavior)
            return '.' + fullPkgs[0] + '.' + messageName
        }
    }

    // If no match found, just add leading dot
    return '.' + typeName
}

function isKnownType(fqn: string, typeMap: Map<string, string[]>): boolean {
    // Check if this FQN exists in any of the typeMap value arrays
    for (const fqns of typeMap.values()) {
        if (fqns.includes(fqn)) {
            return true
        }
    }

    return false
}
