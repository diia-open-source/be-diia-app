/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line import/no-extraneous-dependencies, n/no-unpublished-import
import ts from 'typescript'

class TypeParser {
    private program!: ts.Program

    private checker!: ts.TypeChecker

    private stringTypes = ['ObjectId']

    private allowedToParsePackagePrefixes = ['@diia']

    parseType(type: ts.Type, program?: ts.Program): ts.ObjectLiteralExpression {
        if (program) {
            this.program = program
            this.checker = program.getTypeChecker()
        }

        const flags: ts.TypeFlags = type.flags

        if (this.isNull(flags)) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            return
        }

        if (this.isPrimitive(flags)) {
            return this.parsePrimitive(type)
        }

        if (flags === ts.TypeFlags.Object) {
            return this.parseObjectType(type as ts.ObjectType, type)
        }

        if (flags === ts.TypeFlags.Union) {
            return this.parseUnion(type)
        }

        if (flags === ts.TypeFlags.Intersection) {
            return this.parseIntersection(type)
        }

        if (flags & ts.TypeFlags.EnumLike) {
            return this.parseEnum(type)
        }

        // eslint-disable-next-line no-console
        console.log(`Unknown type in OpenAPI response generator: ${(type as any).intrinsicName ?? type.symbol?.getName()}`)

        return ts.factory.createObjectLiteralExpression()
    }

    parseInterface(type: ts.Type): ts.ObjectLiteralExpression {
        const properties = this.checker
            ?.getPropertiesOfType(type)
            .filter((property) => property?.declarations?.length || (property as any).type)
            .filter((property) => {
                if (property.declarations?.length) {
                    return !ts.isMethodDeclaration(property.declarations[0])
                }

                return true
            })

        const propertiesAssignments: ts.PropertyAssignment[] = properties.map((property) => {
            let parsed: ts.ObjectLiteralExpression

            if (property.declarations) {
                const nestedType: ts.Type = this.checker.getTypeOfSymbolAtLocation(property, property.declarations[0])

                parsed = this.parseType(nestedType)
            } else {
                parsed = this.parseType((property as any).type)
            }

            parsed = this.addMetadataToProperty(property, parsed)

            return ts.factory.createPropertyAssignment(`"${property.name}"`, parsed)
        })

        if (propertiesAssignments.length === 0) {
            return ts.factory.createObjectLiteralExpression()
        }

        const nestedPropertyAssignments: ts.PropertyAssignment[] = []

        const requiredValues = properties
            .filter((prop) => prop.declarations)
            .map((prop) => {
                const declaration = prop.declarations?.[0] as ts.ParameterDeclaration
                const required: boolean = declaration?.questionToken ? false : true

                if (required) {
                    return ts.factory.createStringLiteral(prop.getName())
                }
            })
            // eslint-disable-next-line unicorn/prefer-native-coercion-functions
            .filter((prop): prop is ts.StringLiteral => Boolean(prop))

        nestedPropertyAssignments.push(
            ts.factory.createPropertyAssignment('required', ts.factory.createArrayLiteralExpression(requiredValues)),
            ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('object')),
            ts.factory.createPropertyAssignment('properties', ts.factory.createObjectLiteralExpression(propertiesAssignments)),
        )

        return ts.factory.createObjectLiteralExpression(nestedPropertyAssignments)
    }

    parsePrimitive(type: ts.Type): ts.ObjectLiteralExpression {
        const props: ts.PropertyAssignment[] = []
        if (type.flags & ts.TypeFlags.Literal) {
            // eslint-disable-next-line no-prototype-builtins
            if (!type.hasOwnProperty('value') && type.hasOwnProperty('intrinsicName')) {
                props.push(
                    ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('string')),
                    ts.factory.createPropertyAssignment(
                        'enum',
                        ts.factory.createArrayLiteralExpression([
                            (type as any).intrinsicName === 'true' ? ts.factory.createTrue() : ts.factory.createFalse(),
                        ]),
                    ),
                )

                return ts.factory.createObjectLiteralExpression(props)
            }

            props.push(
                ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('string')),
                ts.factory.createPropertyAssignment(
                    'enum',
                    ts.factory.createArrayLiteralExpression([this.createLiteral((type as any).value)]),
                ),
            )

            return ts.factory.createObjectLiteralExpression(props)
        }

        let typeString: string = this.checker.typeToString(type)
        if (typeString === 'unknown') {
            typeString = 'any'
        }

        props.push(ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral(typeString)))

        return ts.factory.createObjectLiteralExpression(props)
    }

    parseEnum(type: ts.Type): ts.ObjectLiteralExpression {
        const enumType: ts.UnionOrIntersectionType = type as ts.UnionOrIntersectionType
        const values: ts.Expression[] = enumType.types.map((enumProperty) => {
            return this.createLiteral((enumProperty as any).value)
        })

        const props: ts.PropertyAssignment[] = [
            ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('string')),
            ts.factory.createPropertyAssignment('enum', ts.factory.createArrayLiteralExpression(values)),
        ]

        return ts.factory.createObjectLiteralExpression(props)
    }

    parseArray(type: ts.TypeReference): ts.ObjectLiteralExpression {
        const props: ts.PropertyAssignment[] = []

        if (type.typeArguments) {
            props.push(
                ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('array')),
                ts.factory.createPropertyAssignment('items', this.parseType(type.typeArguments[0])),
            )
        } else {
            props.push(ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('array')))
        }

        return ts.factory.createObjectLiteralExpression(props)
    }

    parseTuple(type: ts.TypeReference): ts.ObjectLiteralExpression {
        if (!type.typeArguments) {
            return this.parseArray(type)
        }

        const props: ts.PropertyAssignment[] = []

        const tupleDescription = 'This is array response (tuple type)'
        const elements = type.typeArguments.length

        props.push(ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('object')))

        const tupleElements: ts.PropertyAssignment[] = []

        for (const [index, elementType] of Object.entries(type.typeArguments)) {
            tupleElements.push(ts.factory.createPropertyAssignment(index, this.parseType(elementType)))
        }

        props.push(
            ts.factory.createPropertyAssignment('properties', ts.factory.createObjectLiteralExpression(tupleElements)),
            ts.factory.createPropertyAssignment('description', ts.factory.createStringLiteral(tupleDescription)),
            ts.factory.createPropertyAssignment('minItems', ts.factory.createNumericLiteral(elements)),
            ts.factory.createPropertyAssignment('maxItems', ts.factory.createNumericLiteral(elements)),
        )

        return ts.factory.createObjectLiteralExpression(props)
    }

    parseUnion(type: ts.Type): ts.ObjectLiteralExpression {
        const unionType: ts.UnionOrIntersectionType = type as ts.UnionOrIntersectionType

        let firstBoolean = true
        const types = unionType.types.filter((unionProperty) => {
            if (unionProperty.flags & ts.TypeFlags.BooleanLiteral) {
                if (firstBoolean) {
                    firstBoolean = false

                    return true
                } else {
                    return false
                }
            }

            return this.checker.typeToString(unionProperty) === 'undefined' ? false : true
        })

        if (types.length === 1) {
            const unionProperty: ts.Type = types[0]
            if (unionProperty.flags & ts.TypeFlags.BooleanLiteral) {
                return ts.factory.createObjectLiteralExpression([
                    ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('boolean')),
                ])
            }

            return this.parseType(unionProperty)
        }

        let literals: boolean = types.length > 0 ? true : false
        let primitives: boolean = types.length > 0 ? true : false
        for (const unionProperty of types) {
            if (!(unionProperty.flags & ts.TypeFlags.Literal)) {
                literals = false
            }

            if (
                !(
                    unionProperty.flags & ts.TypeFlags.Number ||
                    unionProperty.flags & ts.TypeFlags.String ||
                    unionProperty.flags & ts.TypeFlags.Boolean ||
                    unionProperty.flags & ts.TypeFlags.Null ||
                    unionProperty.flags & ts.TypeFlags.BigInt
                )
            ) {
                primitives = false
            }
        }

        if (literals) {
            const values = types.map((unionProperty) => {
                if (unionProperty.flags & ts.TypeFlags.BooleanLiteral) {
                    return this.checker.typeToString(unionProperty) === 'false' ? ts.factory.createFalse() : ts.factory.createTrue()
                }

                return this.createLiteral((unionProperty as any).value)
            })

            const props: ts.PropertyAssignment[] = [
                ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('string')),
                ts.factory.createPropertyAssignment('enum', ts.factory.createArrayLiteralExpression(values)),
            ]

            return ts.factory.createObjectLiteralExpression(props)
        } else if (primitives) {
            const values: ts.StringLiteral[] = types.map((unionProperty) => {
                return ts.factory.createStringLiteral((unionProperty as any).intrinsicName)
            })

            return ts.factory.createObjectLiteralExpression([
                ts.factory.createPropertyAssignment('type', ts.factory.createArrayLiteralExpression(values)),
            ])
        }

        const mappedTypes: ts.ObjectLiteralExpression[] = types.map((unionProperty) => {
            if (unionProperty.flags & ts.TypeFlags.BooleanLiteral) {
                return ts.factory.createObjectLiteralExpression([
                    ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('boolean')),
                ])
            }

            const mappedType = this.parseType(unionProperty)
            if (unionProperty.symbol && unionProperty.symbol?.getName() !== '__type') {
                const title: ts.PropertyAssignment = ts.factory.createPropertyAssignment(
                    'title',
                    ts.factory.createStringLiteral(unionProperty.symbol.getName()),
                )

                return ts.factory.updateObjectLiteralExpression(mappedType, [...mappedType.properties, title])
            }

            return mappedType
        })

        const anyOfProperty = ts.factory.createPropertyAssignment('anyOf', ts.factory.createArrayLiteralExpression(mappedTypes))

        return ts.factory.createObjectLiteralExpression([anyOfProperty])
    }

    parseIntersection(type: ts.Type): ts.ObjectLiteralExpression {
        const intersectionType: ts.UnionOrIntersectionType = type as ts.UnionOrIntersectionType
        const types: ts.ObjectLiteralExpression[] = intersectionType.types.map((intersectionProperty) => {
            return this.parseType(intersectionProperty)
        })

        const combinedProperties: ts.ObjectLiteralElementLike[] = []
        const additionalProperties: ts.ObjectLiteralElementLike[] = []
        const unique: string[] = []
        const requiredValues: ts.StringLiteral[] = []

        for (const t of types.toReversed()) {
            for (const property of t.properties) {
                if (property.name) {
                    const identifier = property.name as ts.Identifier
                    if (['properties', 'additionalProperties'].includes(identifier.escapedText.toString())) {
                        const assignment = property as ts.PropertyAssignment
                        const props = assignment.initializer as ts.ObjectLiteralExpressionBase<ts.PropertyAssignment>

                        for (const prop of props.properties) {
                            const id: ts.Identifier = prop.name as ts.Identifier

                            // if (!prop.questionToken) {
                            requiredValues.push(ts.factory.createStringLiteral(id.escapedText.toString()))
                            // }

                            if (!unique.includes(id.escapedText.toString())) {
                                unique.push(id.escapedText.toString())
                                if (identifier.escapedText === 'properties') {
                                    combinedProperties.push(prop)
                                } else {
                                    additionalProperties.push(prop)
                                }
                            }
                        }
                    }
                }
            }
        }

        const propertyAssignments: ts.PropertyAssignment[] = [
            ts.factory.createPropertyAssignment('required', ts.factory.createArrayLiteralExpression(requiredValues)),
            ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('object')),
            ts.factory.createPropertyAssignment('properties', ts.factory.createObjectLiteralExpression(combinedProperties)),
        ]

        if (additionalProperties.length > 0) {
            propertyAssignments.push(
                ts.factory.createPropertyAssignment('additionalProperties', ts.factory.createObjectLiteralExpression(additionalProperties)),
            )
        }

        return ts.factory.createObjectLiteralExpression(propertyAssignments)
    }

    parseLongRecord(type: ts.Type): ts.ObjectLiteralExpression {
        const keyNames: string[] = []
        const properties: ts.Symbol[] = this.checker.getPropertiesOfType(type)

        properties.map((prop) => {
            keyNames.push(prop.escapedName.toString())
        })

        const recordValueType: ts.Type = (properties[0] as any)?.type

        let additionalPropertiesObject: ts.ObjectLiteralExpression = this.parseType(recordValueType)
        const description: ts.PropertyAssignment = ts.factory.createPropertyAssignment(
            'description',
            ts.factory.createStringLiteral(`**Keys**: ${keyNames.join(' | ')}`),
        )

        additionalPropertiesObject = ts.factory.updateObjectLiteralExpression(additionalPropertiesObject, [
            ...additionalPropertiesObject.properties,
            description,
        ])

        return ts.factory.createObjectLiteralExpression([
            ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('object')),
            ts.factory.createPropertyAssignment('additionalProperties', additionalPropertiesObject),
        ])
    }

    parseTypeFromExternalPackage(type: ts.Type): ts.ObjectLiteralExpression | undefined {
        const sourceFile = type.symbol?.declarations?.[0]?.getSourceFile()
        const sourcePathParts = sourceFile?.fileName.split('/') || []
        const packageNameIndexes: number[] = []

        for (const [index, part] of sourcePathParts.entries()) {
            if (part === 'node_modules') {
                packageNameIndexes.push(index + 1)
            }
        }

        for (const packageIndex of packageNameIndexes) {
            const externalPackageName = sourcePathParts[packageIndex]

            if (this.allowedToParsePackagePrefixes.some((prefix) => !externalPackageName.startsWith(prefix))) {
                return ts.factory.createObjectLiteralExpression([
                    ts.factory.createPropertyAssignment(
                        'type',
                        ts.factory.createStringLiteral(`${externalPackageName}.${type.symbol.getName()}`),
                    ),
                ])
            }
        }
    }

    parseIndexedObject(indexInfo: ts.IndexInfo): ts.ObjectLiteralExpression {
        const indexType: ts.Type = indexInfo.type

        return ts.factory.createObjectLiteralExpression([
            ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('object')),
            ts.factory.createPropertyAssignment('additionalProperties', this.parseType(indexType)),
        ])
    }

    private parseObjectType(objectType: ts.ObjectType, type: ts.Type): ts.ObjectLiteralExpression {
        if ((this.checker as any).isArrayType(objectType)) {
            return this.parseArray(objectType as ts.TypeReference)
        }

        if ((this.checker as any).isTupleType(objectType)) {
            return this.parseTuple(objectType as ts.TypeReference)
        }

        const name: string = objectType.symbol?.name
        if (this.stringTypes.includes(name)) {
            return ts.factory.createObjectLiteralExpression([
                ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('string')),
            ])
        }

        if (name === 'Date') {
            return ts.factory.createObjectLiteralExpression([
                ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('string')),
                ts.factory.createPropertyAssignment('format', ts.factory.createStringLiteral('date-time')),
            ])
        }

        if (name === 'Buffer') {
            return ts.factory.createObjectLiteralExpression([
                ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral('string')),
                ts.factory.createPropertyAssignment('format', ts.factory.createStringLiteral('binary')),
            ])
        }

        const indexInfo =
            this?.checker?.getIndexInfoOfType(type, ts.IndexKind.Number) || this?.checker?.getIndexInfoOfType(type, ts.IndexKind.String)

        if (indexInfo) {
            return this.parseIndexedObject(indexInfo)
        }

        if (this.isExternalPackage(type)) {
            const external = this.parseTypeFromExternalPackage(type)
            if (external) {
                return external
            }
        }

        if (this.isRecordWithManyKeys(type)) {
            return this.parseLongRecord(type)
        }

        return this.parseInterface(type)
    }

    private isPrimitive(flags: ts.TypeFlags): boolean {
        return (
            Boolean(flags & ts.TypeFlags.StringLike) ||
            Boolean(flags & ts.TypeFlags.NumberLike) ||
            Boolean(flags & ts.TypeFlags.BooleanLike) ||
            flags === ts.TypeFlags.Any ||
            flags === ts.TypeFlags.Unknown
        )
    }

    private isNull(flags: ts.TypeFlags): boolean {
        return (
            flags === ts.TypeFlags.Null || flags === ts.TypeFlags.Undefined || flags === ts.TypeFlags.Never || flags === ts.TypeFlags.Void
        )
    }

    private isRecordWithManyKeys(type: ts.Type): boolean {
        const isRecord: boolean =
            type.aliasSymbol?.escapedName === 'Record' || type?.aliasTypeArguments?.length
                ? type?.aliasTypeArguments?.[0]?.aliasSymbol?.escapedName === 'Record'
                : false

        if (!isRecord) {
            return false
        }

        const properties: ts.Symbol[] = this.checker.getPropertiesOfType(type)
        const recordValueType: ts.Type = (properties[0] as any)?.type

        return recordValueType && properties.length > 5
    }

    private isExternalPackage(type: ts.Type): boolean {
        const sourceFile = type.symbol?.declarations?.[0]?.getSourceFile()
        const isExternal = sourceFile && this.program.isSourceFileFromExternalLibrary(sourceFile)

        if (type.symbol.getName() === '__type') {
            return false
        }

        return Boolean(isExternal)
    }

    private addMetadataToProperty(property: ts.Symbol, parsed: ts.ObjectLiteralExpression): ts.ObjectLiteralExpression {
        const description: ts.SymbolDisplayPart[] = property.getDocumentationComment(this.checker)
        if (description.length > 0) {
            const descriptionProperty: ts.PropertyAssignment = this.createPropertyFromMetadata('description', description[0])

            parsed = this.addProperties(parsed, [descriptionProperty])
        }

        const docTags = property.getJsDocTags()

        const properties = docTags
            .filter((tag) => tag.text)
            .flatMap(({ name, text }) => text?.map((t) => this.createPropertyFromMetadata(name, t)) || [])

        if (docTags.length > 0 && parsed.properties) {
            parsed = this.addProperties(parsed, properties)
        }

        return parsed
    }

    private addProperties(
        object: ts.ObjectLiteralExpression,
        combinedProperties: ts.ObjectLiteralElementLike[],
    ): ts.ObjectLiteralExpression {
        if (!object.properties) {
            return object
        }

        for (const property of object.properties) {
            combinedProperties.push(property)
        }

        return ts.factory.createObjectLiteralExpression(combinedProperties)
    }

    private createPropertyFromMetadata(propertyName: string, commentPart: ts.SymbolDisplayPart): ts.PropertyAssignment {
        const { text } = commentPart
        const literal: ts.Expression = this.createLiteral(text)

        return ts.factory.createPropertyAssignment(propertyName, literal)
    }

    private createLiteral(value: string): ts.Expression {
        if (value === 'true') {
            return ts.factory.createTrue()
        } else if (value === 'false') {
            return ts.factory.createFalse()
            // eslint-disable-next-line regexp/no-unused-capturing-group, security/detect-unsafe-regex
        } else if (/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(value)) {
            return ts.factory.createNumericLiteral(Number(value))
        } else {
            return ts.factory.createStringLiteral(value)
        }
    }
}

export default new TypeParser()
