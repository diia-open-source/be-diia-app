import { NodeFlags, Program, SyntaxKind, Type, TypeFlags, factory } from 'typescript'

import typeParser from '../../../../src/plugins/openapi/parser'
import {
    arrayMatcher,
    bufferMatcher,
    dateMatcher,
    emptyArrayMatcher,
    externalPackageTypeMatcher,
    indexedNumberMatcher,
    indexedStringMatcher,
    interfaceMatcher,
    literalMatcher,
    literalWithoutValueMatcher,
    objectIdMatcher,
    recordMatcher,
    stringMatcher,
    tupleMatcher,
} from '../../../mocks'

const typeChecker = {
    getIndexInfoOfType(): unknown {
        return
    },
    getPropertiesOfType(): unknown {
        return
    },
    getTypeOfSymbolAtLocation(_prop: unknown, { type }: { type: unknown }): unknown {
        return type
    },
    isArrayType(): boolean {
        return false
    },
    isTupleType(): boolean {
        return false
    },
    typeToString(): string {
        return 'unknown'
    },
}

const programMock = {
    getTypeChecker(): typeof typeChecker {
        return typeChecker
    },
    isSourceFileFromExternalLibrary(): boolean {
        return false
    },
}

const typePropMixin = {
    getDocumentationComment(): unknown[] {
        return []
    },
    getJsDocTags(): unknown[] {
        return []
    },
    getName(): string {
        return 'name'
    },
}

describe(`OpenApi typeParser`, () => {
    describe(`method parseType`, () => {
        it('should return undefined if type has null flag', () => {
            const type = <Type>{
                flags: TypeFlags.Null,
            }

            const result = typeParser.parseType(type)

            expect(result).toBeUndefined()
        })

        it('should return default object literal expression', () => {
            const type = <Type>(<unknown>{
                flags: 0,
                intrinsicName: 'intrinsicName',
                symbol: { name: 'symbolName' },
            })

            jest.spyOn(console, 'log').mockImplementation(() => {})

            const expected = factory.createObjectLiteralExpression()

            const result = typeParser.parseType(type)

            expect(result).toEqual(expected)
        })

        it('should parse string', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.String,
                value: 'string1',
                symbol: { name: 'symbolName' },
                intrinsicName: 'intrinsicName',
            })

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(stringMatcher)
        })

        it('should parse literal', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.NumberLike,
                value: 10,
            })

            const result = typeParser.parseType(type)

            expect(result).toMatchObject(literalMatcher)
        })

        it('should parse literal without value', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.NumberLike,
                symbol: { name: 'symbolName' },
                intrinsicName: 'true',
            })

            const result = typeParser.parseType(type)

            expect(result).toMatchObject(literalWithoutValueMatcher)
        })

        it('should parse array', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.Object,
                typeArguments: [
                    {
                        flags: TypeFlags.String,
                        value: 'string1',
                        symbol: { name: 'symbolName' },
                        intrinsicName: 'intrinsicName',
                    },
                ],
            })

            jest.spyOn(typeChecker, 'isArrayType').mockReturnValueOnce(true)

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(arrayMatcher)
        })

        it('should parse empty array', () => {
            const type = <Type>(<unknown>{ flags: TypeFlags.Object })

            jest.spyOn(typeChecker, 'isArrayType').mockReturnValueOnce(true)

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(emptyArrayMatcher)
        })

        it('should parse empty tuple', () => {
            const type = <Type>(<unknown>{ flags: TypeFlags.Object })

            jest.spyOn(typeChecker, 'isTupleType').mockReturnValueOnce(true)

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(emptyArrayMatcher)
        })

        it('should parse tuple', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.Object,
                typeArguments: [
                    {
                        flags: TypeFlags.String,
                        value: 'string1',
                        intrinsicName: 'intrinsicName',
                    },
                    {
                        flags: TypeFlags.BooleanLike,
                        value: false,
                    },
                ],
            })

            jest.spyOn(typeChecker, 'isTupleType').mockReturnValueOnce(true)

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(tupleMatcher)
        })

        it('should parse ObjectId', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.Object,
                symbol: { name: 'ObjectId' },
            })

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(objectIdMatcher)
        })

        it('should parse Date', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.Object,
                symbol: { name: 'Date' },
            })

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(dateMatcher)
        })

        it('should parse Buffer', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.Object,
                symbol: { name: 'Buffer' },
            })

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(bufferMatcher)
        })

        it('should parse indexed object of Number type', () => {
            const type = <Type>(<unknown>{ flags: TypeFlags.Object })

            jest.spyOn(typeChecker, 'getIndexInfoOfType').mockReturnValueOnce({
                type: {
                    flags: TypeFlags.Number,
                    value: 13,
                },
            })

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(indexedNumberMatcher)
        })

        it('should parse indexed object of String type', () => {
            const type = <Type>(<unknown>{ flags: TypeFlags.Object })

            jest.spyOn(typeChecker, 'getIndexInfoOfType').mockReturnValueOnce({
                type: {
                    flags: TypeFlags.String,
                    value: 'mocked string',
                },
            })

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(indexedStringMatcher)
        })

        it('should parse type from external package', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.Object,
                symbol: {
                    declarations: [
                        {
                            getSourceFile(): { fileName: string } {
                                return { fileName: 'node_modules/pkg-external/file.js' }
                            },
                        },
                    ],
                    getName(): string {
                        return 'externalType'
                    },
                },
            })

            jest.spyOn(programMock, 'isSourceFileFromExternalLibrary').mockReturnValueOnce(true)

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(externalPackageTypeMatcher)
        })

        it('should parse record with many keys', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.Object,
                aliasTypeArguments: [
                    {
                        aliasSymbol: {
                            escapedName: 'Record',
                        },
                    },
                ],
                symbol: {
                    getName(): string {
                        return '__type'
                    },
                },
            })

            jest.spyOn(typeChecker, 'getPropertiesOfType').mockReturnValue([
                {
                    type: {
                        flags: TypeFlags.NumberLike,
                        value: 17,
                    },
                    escapedName: 'prop1',
                },
                { escapedName: 'prop2' },
                { escapedName: 'prop3' },
                { escapedName: 'prop4' },
                { escapedName: 'prop5' },
                { escapedName: 'prop6' },
            ])

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(recordMatcher)
        })

        it('should parse interface', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.Object,
                symbol: {
                    getName(): string {
                        return '__type'
                    },
                },
            })

            jest.spyOn(typeChecker, 'getPropertiesOfType').mockReturnValue([
                {
                    ...typePropMixin,
                    type: {
                        flags: TypeFlags.NumberLike,
                        value: 19,
                    },
                    escapedName: 'prop1',
                },
                {
                    ...typePropMixin,
                    declarations: [
                        {
                            type: {
                                flags: TypeFlags.StringLike,
                                value: 'string2',
                            },
                            escapedName: 'prop2',
                        },
                    ],
                },
            ])

            const result = typeParser.parseType(type, <Program>(<unknown>programMock))

            expect(result).toMatchObject(interfaceMatcher)
        })

        it('should parse intersection', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.Intersection,
                types: [
                    {
                        flags: TypeFlags.String,
                        value: 'string1',
                        symbol: { name: 'symbolName' },
                        intrinsicName: 'intrinsicName',
                    },
                ],
            })

            jest.spyOn(typeChecker, 'typeToString').mockReturnValue('unknown')

            const result = typeParser.parseType(type)

            expect(result).toMatchObject(
                expect.objectContaining({
                    flags: NodeFlags.Synthesized,
                    kind: SyntaxKind.ObjectLiteralExpression,
                    properties: expect.arrayContaining([
                        expect.objectContaining({
                            initializer: expect.objectContaining({
                                kind: SyntaxKind.StringLiteral,
                            }),
                            kind: SyntaxKind.PropertyAssignment,
                        }),
                    ]),
                }),
            )
        })

        it('should parse Enum', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.EnumLike,
                types: [
                    {
                        flags: TypeFlags.Enum,
                        value: 'enum1',
                    },
                ],
            })

            const result = typeParser.parseEnum(type)

            expect(result).toMatchObject(
                expect.objectContaining({
                    flags: NodeFlags.Synthesized,
                    kind: SyntaxKind.ObjectLiteralExpression,
                    properties: expect.arrayContaining([
                        expect.objectContaining({
                            initializer: expect.objectContaining({
                                kind: SyntaxKind.StringLiteral,
                            }),
                            kind: SyntaxKind.PropertyAssignment,
                        }),
                    ]),
                }),
            )
        })

        it('should parse union with couple types', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.Union,
                types: [
                    {
                        flags: TypeFlags.BooleanLiteral,
                        value: false,
                    },
                    {
                        flags: TypeFlags.String,
                        value: 'string',
                    },
                ],
            })

            const result = typeParser.parseUnion(type)

            expect(result).toMatchObject(
                expect.objectContaining({
                    flags: NodeFlags.Synthesized,
                    kind: SyntaxKind.ObjectLiteralExpression,
                }),
            )
        })

        it('should parse union with one types', () => {
            const type = <Type>(<unknown>{
                flags: TypeFlags.Union,
                types: [
                    {
                        flags: TypeFlags.BooleanLiteral,
                        value: false,
                    },
                ],
            })

            const result = typeParser.parseUnion(type)

            expect(result).toMatchObject(
                expect.objectContaining({
                    flags: NodeFlags.Synthesized,
                    kind: SyntaxKind.ObjectLiteralExpression,
                }),
            )
        })
    })
})
