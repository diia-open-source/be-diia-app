import protobuf from 'protobufjs'

import { JsonSchema, JsonSchemaMap, JsonSchemaObject, JsonSchemaPrimitive, JsonSchemaProperty, JsonSchemaRef } from './types'

export class JsonSchemaGenerator {
    private static readonly protoToJsonType: Record<string, JsonSchemaPrimitive> = {
        double: { type: 'number' },
        float: { type: 'number' },
        int32: { type: 'integer' },
        int64: { type: 'integer' },
        uint32: { type: 'integer' },
        uint64: { type: 'integer' },
        sint32: { type: 'integer' },
        sint64: { type: 'integer' },
        fixed32: { type: 'integer' },
        fixed64: { type: 'integer' },
        sfixed32: { type: 'integer' },
        sfixed64: { type: 'integer' },
        bool: { type: 'boolean' },
        string: { type: 'string' },
        bytes: { type: 'string', format: 'byte' },
    }

    private static readonly googleWellKnownTypes: Record<string, JsonSchemaProperty> = {
        'google.protobuf.Timestamp': { type: 'string', format: 'date-time', description: 'RFC 3339 formatted timestamp' },
        'google.protobuf.Duration': { type: 'string', description: 'Duration in seconds with up to 9 fractional digits, e.g. "3.5s"' },
        'google.protobuf.Empty': { type: 'object', properties: {} },
        'google.protobuf.Any': {
            type: 'object',
            properties: { '@type': { type: 'string', description: 'Type URL of the serialized message' } },
            description: 'Arbitrary serialized protocol buffer message',
        },
        'google.protobuf.Struct': { type: 'object', properties: {}, description: 'JSON object' },
        'google.protobuf.Value': { type: 'object', properties: {}, description: 'Represents any JSON value' },
        'google.protobuf.ListValue': { type: 'array', items: { type: 'object', properties: {} }, description: 'JSON array' },
        'google.protobuf.FieldMask': { type: 'string', description: 'Comma-separated list of field paths' },
        'google.protobuf.BoolValue': { type: 'boolean', description: 'Nullable boolean' },
        'google.protobuf.BytesValue': { type: 'string', format: 'byte', description: 'Nullable bytes' },
        'google.protobuf.DoubleValue': { type: 'number', description: 'Nullable double' },
        'google.protobuf.FloatValue': { type: 'number', description: 'Nullable float' },
        'google.protobuf.Int32Value': { type: 'integer', description: 'Nullable int32' },
        'google.protobuf.Int64Value': { type: 'integer', description: 'Nullable int64' },
        'google.protobuf.UInt32Value': { type: 'integer', description: 'Nullable uint32' },
        'google.protobuf.UInt64Value': { type: 'integer', description: 'Nullable uint64' },
        'google.protobuf.StringValue': { type: 'string', description: 'Nullable string' },
    }

    constructor(
        private readonly protoRoot: protobuf.Root,
        private readonly fieldComments: Map<string, string>,
        private readonly messageComments: Map<string, string>,
    ) {}

    generateSchema(typeName: string): JsonSchema {
        if (!typeName) {
            return { type: 'object', properties: {} }
        }

        const definitions: Record<string, JsonSchemaProperty> = {}
        const definitionNames = new Map<string, string>()
        const schema = this.typeToSchema(typeName, new Set(), definitions, definitionNames)

        if (Object.keys(definitions).length > 0) {
            return { ...schema, definitions }
        }

        return schema
    }

    private typeToSchema(
        typeName: string,
        visited: Set<string>,
        definitions: Record<string, JsonSchemaProperty>,
        definitionNames: Map<string, string>,
    ): JsonSchemaObject {
        let type: protobuf.Type
        try {
            type = this.protoRoot.lookupType(typeName)
        } catch {
            return { type: 'object', properties: {} }
        }

        const properties: Record<string, JsonSchemaProperty> = {}
        const required: string[] = []

        for (const field of type.fieldsArray) {
            properties[field.name] = this.fieldToSchema(field, visited, definitions, definitionNames, type.name)

            const isExplicitlyOptional = field.partOf?.name?.startsWith('_')
            const isArray = field.repeated
            if (!isExplicitlyOptional && !isArray) {
                required.push(field.name)
            }
        }

        const result: JsonSchemaObject = {
            type: 'object',
            properties,
            protoSource: this.generateMessageProtoSource(type),
        }

        const shortName = typeName.split('.').pop() || typeName
        const messageComment = this.messageComments.get(shortName)
        if (messageComment) {
            result.description = messageComment
        }

        if (required.length > 0) {
            result.required = required
        }

        return result
    }

    private fieldToSchema(
        field: protobuf.Field,
        visited: Set<string>,
        definitions: Record<string, JsonSchemaProperty>,
        definitionNames: Map<string, string>,
        parentTypeName: string,
    ): JsonSchemaProperty {
        if (field instanceof protobuf.MapField) {
            return this.mapFieldToSchema(field, visited, definitions, definitionNames, parentTypeName)
        }

        let schema: JsonSchemaProperty | undefined = JsonSchemaGenerator.protoToJsonType[field.type]
            ? { ...JsonSchemaGenerator.protoToJsonType[field.type] }
            : undefined

        if (!schema) {
            // Use resolved type's full name to get the correct type when there are name collisions
            // If resolvedType is not available, try to resolve using parent context
            let resolvedTypeName = field.resolvedType?.fullName?.replace(/^\./, '') || field.type

            // If the type wasn't resolved by protobufjs and it's a short name, check for nested type
            if (!field.resolvedType && !field.type.includes('.')) {
                const parentType = field.parent
                if (parentType instanceof protobuf.Type) {
                    // Check if there's a nested type with this name in the parent
                    const nestedType = parentType.nested?.[field.type]
                    if (nestedType instanceof protobuf.Type) {
                        resolvedTypeName = nestedType.fullName.replace(/^\./, '')
                    }
                }
            }

            schema = this.resolveComplexType(resolvedTypeName, visited, definitions, definitionNames)
        }

        schema = this.addFieldDescription(schema, field.name, parentTypeName)

        if (field.repeated) {
            return { type: 'array', items: schema }
        }

        return schema
    }

    private mapFieldToSchema(
        field: protobuf.MapField,
        visited: Set<string>,
        definitions: Record<string, JsonSchemaProperty>,
        definitionNames: Map<string, string>,
        parentTypeName: string,
    ): JsonSchemaProperty {
        let valueSchema: JsonSchemaProperty | undefined = JsonSchemaGenerator.protoToJsonType[field.type]
            ? { ...JsonSchemaGenerator.protoToJsonType[field.type] }
            : undefined

        if (!valueSchema) {
            let resolvedTypeName = field.resolvedType?.fullName?.replace(/^\./, '') || field.type

            // If the type wasn't resolved and it's a short name, check for nested type in parent
            if (!field.resolvedType && !field.type.includes('.')) {
                const parentType = field.parent
                if (parentType instanceof protobuf.Type) {
                    const nestedType = parentType.nested?.[field.type]
                    if (nestedType instanceof protobuf.Type) {
                        resolvedTypeName = nestedType.fullName.replace(/^\./, '')
                    }
                }
            }

            valueSchema = this.resolveComplexType(resolvedTypeName, visited, definitions, definitionNames)
        }

        const mapSchema: JsonSchemaMap = {
            type: 'object',
            additionalProperties: valueSchema,
        }

        return this.addFieldDescription(mapSchema, field.name, parentTypeName)
    }

    private resolveComplexType(
        typeName: string,
        visited: Set<string>,
        definitions: Record<string, JsonSchemaProperty>,
        definitionNames: Map<string, string>,
    ): JsonSchemaProperty {
        const shortName = typeName.split('.').pop() || typeName
        const resolved = this.protoRoot.lookup(typeName)
        const isNestedType = resolved?.parent instanceof protobuf.Type

        const definitionName = this.getDefinitionName(typeName, shortName, definitionNames, isNestedType)

        if (definitions[definitionName]) {
            return { $ref: `#/definitions/${definitionName}` }
        }

        if (visited.has(typeName) || visited.has(shortName)) {
            return { $ref: `#/definitions/${definitionName}` }
        }

        try {
            const nestedType = this.protoRoot.lookupType(typeName)

            return this.resolveMessageType(nestedType, typeName, definitionName, visited, definitions, definitionNames)
        } catch {
            return this.tryResolveEnumType(typeName, definitionName, definitions, definitionNames)
        }
    }

    private getDefinitionName(fullName: string, shortName: string, definitionNames: Map<string, string>, isNestedType = false): string {
        const existingName = definitionNames.get(fullName)
        if (existingName) {
            return existingName
        }

        // For nested types, always use qualified name with parent type
        if (isNestedType) {
            // Extract parent.child format from full name (e.g., "package.Parent.Child" -> "Parent.Child")
            const parts = fullName.split('.')
            const qualifiedName = parts.length >= 2 ? parts.slice(-2).join('.') : fullName

            definitionNames.set(fullName, qualifiedName)

            return qualifiedName
        }

        // Check if shortName is already used by a different type
        for (const [existingFullName, existingDefName] of definitionNames) {
            if (existingDefName === shortName && existingFullName !== fullName) {
                // Short name collision, use full name
                definitionNames.set(fullName, fullName)

                return fullName
            }
        }

        // Short name is available
        definitionNames.set(fullName, shortName)

        return shortName
    }

    private resolveMessageType(
        nestedType: protobuf.Type,
        typeName: string,
        definitionName: string,
        visited: Set<string>,
        definitions: Record<string, JsonSchemaProperty>,
        definitionNames: Map<string, string>,
    ): JsonSchemaRef {
        const shortName = typeName.split('.').pop() || typeName
        const newVisited = new Set(visited)

        newVisited.add(typeName)
        newVisited.add(shortName)

        // Add placeholder to prevent infinite recursion
        definitions[definitionName] = { type: 'object', properties: {} }

        const nestedProperties: Record<string, JsonSchemaProperty> = {}
        const nestedRequired: string[] = []

        for (const nestedField of nestedType.fieldsArray) {
            nestedProperties[nestedField.name] = this.fieldToSchema(nestedField, newVisited, definitions, definitionNames, nestedType.name)

            const isExplicitlyOptional = nestedField.partOf?.name?.startsWith('_')
            const isArray = nestedField.repeated
            if (!isExplicitlyOptional && !isArray) {
                nestedRequired.push(nestedField.name)
            }
        }

        const messageComment = this.messageComments.get(shortName)
        const fullSchema: JsonSchemaObject = {
            type: 'object',
            properties: nestedProperties,
            description: messageComment ? `${definitionName}\n${messageComment}` : definitionName,
            protoSource: this.generateMessageProtoSource(nestedType),
        }

        if (nestedRequired.length > 0) {
            fullSchema.required = nestedRequired
        }

        definitions[definitionName] = fullSchema

        return { $ref: `#/definitions/${definitionName}` }
    }

    private tryResolveEnumType(
        typeName: string,
        definitionName: string,
        definitions: Record<string, JsonSchemaProperty>,
        definitionNames: Map<string, string>,
    ): JsonSchemaProperty {
        try {
            const shortName = typeName.split('.').pop() || typeName
            const enumType = this.protoRoot.lookupEnum(typeName)
            const enumValues = Object.keys(enumType.values)
            const enumComment = this.messageComments.get(shortName)

            definitionNames.set(typeName, definitionName)

            definitions[definitionName] = {
                type: 'string',
                enum: enumValues,
                description: enumComment ? `${definitionName}\n${enumComment}` : definitionName,
                protoSource: this.generateEnumProtoSource(enumType),
            }

            return { $ref: `#/definitions/${definitionName}` }
        } catch {
            const wellKnownSchema = JsonSchemaGenerator.googleWellKnownTypes[typeName]
            if (wellKnownSchema) {
                return wellKnownSchema
            }

            return { type: 'object', properties: {} }
        }
    }

    private addFieldDescription(schema: JsonSchemaProperty, fieldName: string, parentTypeName: string): JsonSchemaProperty {
        const comment = this.getFieldComment(fieldName, parentTypeName)
        if (comment) {
            return { ...schema, description: comment }
        }

        return schema
    }

    private generateMessageProtoSource(type: protobuf.Type, indent = ''): string {
        const lines: string[] = []
        const typeName = type.name
        const innerIndent = indent + '  '
        const oneofInnerIndent = innerIndent + '  '

        // Add message-level comment if exists
        const messageComment = this.messageComments.get(typeName)
        if (messageComment) {
            lines.push(`${indent}// ${messageComment.trim()}`)
        }

        lines.push(`${indent}message ${typeName} {`)

        // Add nested types (messages and enums) first
        if (type.nestedArray && type.nestedArray.length > 0) {
            for (const nested of type.nestedArray) {
                if (nested instanceof protobuf.Type) {
                    const nestedSource = this.generateMessageProtoSource(nested, innerIndent)

                    lines.push(nestedSource, '')
                } else if (nested instanceof protobuf.Enum) {
                    const nestedSource = this.generateEnumProtoSource(nested, innerIndent)

                    lines.push(nestedSource, '')
                }
            }
        }

        // Collect fields that belong to real oneofs (not proto3 optional syntax)
        const fieldsInOneofs = new Set<string>()
        const realOneofs: protobuf.OneOf[] = []

        if (type.oneofsArray && type.oneofsArray.length > 0) {
            for (const oneof of type.oneofsArray) {
                // Skip proto3 optional syntax (oneof names starting with _)
                if (oneof.name.startsWith('_')) {
                    continue
                }

                realOneofs.push(oneof)
                for (const fieldName of oneof.oneof) {
                    fieldsInOneofs.add(fieldName)
                }
            }
        }

        // Generate oneof blocks
        for (const oneof of realOneofs) {
            lines.push(`${innerIndent}oneof ${oneof.name} {`)

            for (const fieldName of oneof.oneof) {
                const field = type.fields[fieldName]
                if (field) {
                    const fieldLine = this.generateOneofFieldProtoLine(field, type.name)

                    lines.push(`${oneofInnerIndent}${fieldLine}`)
                }
            }

            lines.push(`${innerIndent}}`)
        }

        // Generate regular fields (excluding those in oneofs)
        for (const field of type.fieldsArray) {
            if (fieldsInOneofs.has(field.name)) {
                continue
            }

            const fieldLine = this.generateFieldProtoLine(field, type.name)

            lines.push(`${innerIndent}${fieldLine}`)
        }

        lines.push(`${indent}}`)

        return lines.join('\n')
    }

    private generateOneofFieldProtoLine(field: protobuf.Field, parentTypeName: string): string {
        let typePart = ''

        typePart = field instanceof protobuf.MapField ? `map<${field.keyType}, ${field.type}>` : field.type

        let line = `${typePart} ${field.name} = ${field.id};`

        const comment = this.getFieldComment(field.name, parentTypeName)
        if (comment) {
            // Use marker for newlines (converted to <br> in rendering)
            const cleanComment = comment
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .join('{{NL}}')

            line += ` // ${cleanComment}`
        }

        return line
    }

    private generateFieldProtoLine(field: protobuf.Field, parentTypeName: string): string {
        let modifier = ''
        let typePart = ''

        if (field instanceof protobuf.MapField) {
            typePart = `map<${field.keyType}, ${field.type}>`
        } else if (field.repeated) {
            modifier = 'repeated '
            typePart = field.type
        } else {
            const isExplicitlyOptional = field.partOf?.name?.startsWith('_')
            if (isExplicitlyOptional) {
                modifier = 'optional '
            }

            typePart = field.type
        }

        let line = `${modifier}${typePart} ${field.name} = ${field.id};`

        const comment = this.getFieldComment(field.name, parentTypeName)
        if (comment) {
            // Use marker for newlines (converted to <br> in rendering)
            const cleanComment = comment
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .join('{{NL}}')

            line += ` // ${cleanComment}`
        }

        return line
    }

    private generateEnumProtoSource(enumType: protobuf.Enum, indent = ''): string {
        const lines: string[] = []
        const typeName = enumType.name
        const innerIndent = indent + '  '

        // Add enum-level comment if exists
        const enumComment = this.messageComments.get(typeName)
        if (enumComment) {
            lines.push(`${indent}// ${enumComment.trim()}`)
        }

        lines.push(`${indent}enum ${typeName} {`)

        const entries = Object.entries(enumType.values).toSorted(([, a], [, b]) => a - b)
        for (const [valueName, valueNumber] of entries) {
            lines.push(`${innerIndent}${valueName} = ${valueNumber};`)
        }

        lines.push(`${indent}}`)

        return lines.join('\n')
    }

    private getFieldComment(fieldName: string, parentTypeName: string): string | undefined {
        const lookupKey = `${parentTypeName}.${fieldName}`
        let comment = this.fieldComments.get(lookupKey)

        if (!comment && parentTypeName.includes('.')) {
            const shortTypeName = parentTypeName.split('.').pop() || ''

            comment = this.fieldComments.get(`${shortTypeName}.${fieldName}`)
        }

        return comment
    }
}
