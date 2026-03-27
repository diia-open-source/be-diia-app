import { readFile } from 'node:fs/promises'
import path from 'node:path'

import protobuf from 'protobufjs'

import type { Logger } from '@diia-inhouse/types'

import { HTTP_METHODS, MethodMetadata, ProtoMetadata } from './types'

export class ProtoMetadataExtractor {
    constructor(private readonly logger?: Logger) {}

    async extract(protoPaths: string[], includeDirs: string[]): Promise<ProtoMetadata> {
        const root = new protobuf.Root()
        const parsedFiles = new Set<string>()

        for (const protoPath of protoPaths) {
            await this.parseProtoWithImports(protoPath, includeDirs, root, parsedFiles)
        }

        const methods = this.extractMethods(root)
        const methodDescriptions = new Map<string, string>()
        const methodDeprecations = new Map<string, boolean>()
        for (const method of methods) {
            if (method.description) {
                methodDescriptions.set(method.fullPath, method.description)
            }

            if (method.deprecated) {
                methodDeprecations.set(method.fullPath, true)
            }
        }

        return {
            root,
            methods,
            methodDescriptions,
            methodDeprecations,
            fieldComments: this.extractFieldComments(root),
            messageComments: this.extractMessageComments(root),
        }
    }

    private async parseProtoWithImports(
        protoRelativePath: string,
        includeDirs: string[],
        root: protobuf.Root,
        parsedFiles: Set<string>,
    ): Promise<void> {
        if (protoRelativePath.startsWith('google/protobuf/')) {
            return
        }

        const fullPath = await this.resolveProtoPath(protoRelativePath, includeDirs)
        if (!fullPath || parsedFiles.has(fullPath)) {
            return
        }

        parsedFiles.add(fullPath)

        try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const protoContent = await readFile(fullPath, 'utf8') // nosemgrep: eslint.detect-non-literal-fs-filename

            const importRegex = /import\s+["']([^"']+)["']\s*;/g
            const imports: string[] = []
            for (const match of protoContent.matchAll(importRegex)) {
                imports.push(match[1])
            }

            protobuf.parse(protoContent, root, { keepCase: true, alternateCommentMode: true })

            for (const importPath of imports) {
                await this.parseProtoWithImports(importPath, includeDirs, root, parsedFiles)
            }
        } catch (err) {
            this.logger?.warn('Failed to parse proto file', { path: fullPath, err })
        }
    }

    private async resolveProtoPath(protoRelativePath: string, includeDirs: string[]): Promise<string | null> {
        for (const dir of includeDirs) {
            const candidatePath = path.join(dir, protoRelativePath)
            try {
                // eslint-disable-next-line security/detect-non-literal-fs-filename
                await readFile(candidatePath) // nosemgrep: eslint.detect-non-literal-fs-filename

                return candidatePath
            } catch {
                // File doesn't exist, try next directory
            }
        }

        return null
    }

    private extractMethods(root: protobuf.Root): MethodMetadata[] {
        const methods: MethodMetadata[] = []

        const processNamespace = (ns: protobuf.NamespaceBase): void => {
            for (const nested of Object.values(ns.nested || {})) {
                if (nested instanceof protobuf.Service) {
                    for (const method of nested.methodsArray) {
                        const httpOption = this.extractHttpOption(method)
                        const servicePath = nested.fullName.startsWith('.') ? nested.fullName.slice(1) : nested.fullName
                        const { deprecated, description } = this.extractDeprecation(method)

                        methods.push({
                            serviceName: nested.name,
                            methodName: method.name,
                            fullPath: `/${servicePath}/${method.name}`,
                            httpMethod: httpOption?.method,
                            httpPath: httpOption?.path,
                            description,
                            deprecated,
                        })
                    }
                } else if (nested instanceof protobuf.Namespace) {
                    processNamespace(nested)
                }
            }
        }

        processNamespace(root)

        return methods
    }

    private extractFieldComments(root: protobuf.Root): Map<string, string> {
        const comments = new Map<string, string>()

        const processNamespace = (ns: protobuf.NamespaceBase, parentPath = ''): void => {
            for (const [name, nested] of Object.entries(ns.nested || {})) {
                if (nested instanceof protobuf.Type) {
                    const typePath = parentPath ? `${parentPath}.${name}` : name

                    for (const field of nested.fieldsArray) {
                        if (field.comment) {
                            comments.set(`${name}.${field.name}`, field.comment)
                            comments.set(`${typePath}.${field.name}`, field.comment)
                        }
                    }

                    processNamespace(nested, typePath)
                } else if (nested instanceof protobuf.Namespace && !(nested instanceof protobuf.Service)) {
                    const newPath = parentPath ? `${parentPath}.${name}` : name

                    processNamespace(nested, newPath)
                }
            }
        }

        processNamespace(root)

        return comments
    }

    private extractMessageComments(root: protobuf.Root): Map<string, string> {
        const comments = new Map<string, string>()

        const processNamespace = (ns: protobuf.NamespaceBase): void => {
            for (const [name, nested] of Object.entries(ns.nested || {})) {
                if (nested instanceof protobuf.Type) {
                    if (nested.comment) {
                        comments.set(name, nested.comment)
                    }

                    processNamespace(nested)
                } else if (nested instanceof protobuf.Enum) {
                    if (nested.comment) {
                        comments.set(name, nested.comment)
                    }
                } else if (nested instanceof protobuf.Namespace && !(nested instanceof protobuf.Service)) {
                    processNamespace(nested)
                }
            }
        }

        processNamespace(root)

        return comments
    }

    private extractDeprecation(method: protobuf.Method): { deprecated: boolean; description: string | undefined } {
        const rawComment = method.comment || undefined
        const isDeprecatedViaOption = (method.options as Record<string, unknown> | undefined)?.deprecated === true
        const deprecatedPattern = /^[\t ]*@deprecated\b[\t ]*/im
        const isDeprecatedViaComment = rawComment ? deprecatedPattern.test(rawComment) : false
        const deprecated = isDeprecatedViaOption || isDeprecatedViaComment

        let description = rawComment
        if (isDeprecatedViaComment && rawComment) {
            description =
                rawComment
                    .split('\n')
                    .filter((line) => !deprecatedPattern.test(line))
                    .join('\n')
                    .trim() || undefined
        }

        return { deprecated, description }
    }

    private extractHttpOption(method: protobuf.Method): { method: string; path: string } | undefined {
        const options = method.parsedOptions
        if (!options) {
            return undefined
        }

        for (const opt of options) {
            const httpRule = opt['(google.api.http)'] as Record<string, string> | undefined
            if (httpRule) {
                for (const httpMethod of HTTP_METHODS) {
                    if (httpRule[httpMethod]) {
                        return { method: httpMethod.toUpperCase(), path: httpRule[httpMethod] }
                    }
                }
            }
        }

        return undefined
    }
}
