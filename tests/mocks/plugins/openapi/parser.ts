import { NodeFlags, SyntaxKind, TypeFlags } from 'typescript'

export const arrayMatcher = {
    flags: NodeFlags.Synthesized,
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            flags: NodeFlags.Synthesized,
            kind: SyntaxKind.PropertyAssignment,
            initializer: expect.objectContaining({
                flags: NodeFlags.Synthesized,
                kind: SyntaxKind.StringLiteral,
                text: 'array',
            }),
            name: expect.objectContaining({
                escapedText: 'type',
                flags: NodeFlags.Synthesized,
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            flags: NodeFlags.Synthesized,
            kind: SyntaxKind.PropertyAssignment,
            initializer: expect.objectContaining({
                flags: NodeFlags.Synthesized,
                kind: SyntaxKind.ObjectLiteralExpression,
                properties: expect.arrayContaining([
                    expect.objectContaining({
                        flags: NodeFlags.Synthesized,
                        kind: SyntaxKind.PropertyAssignment,
                        initializer: expect.objectContaining({
                            flags: NodeFlags.Synthesized,
                            kind: SyntaxKind.StringLiteral,
                            text: 'any',
                        }),
                        name: expect.objectContaining({
                            escapedText: 'type',
                            flags: NodeFlags.Synthesized,
                            kind: SyntaxKind.Identifier,
                        }),
                    }),
                ]),
            }),
            name: expect.objectContaining({
                escapedText: 'items',
                flags: NodeFlags.Synthesized,
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const bufferMatcher = {
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'string',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'type',
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'binary',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'format',
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const dateMatcher = {
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'string',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'type',
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'date-time',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'format',
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const emptyArrayMatcher = {
    flags: NodeFlags.Synthesized,
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            flags: NodeFlags.Synthesized,
            kind: SyntaxKind.PropertyAssignment,
            initializer: expect.objectContaining({
                flags: NodeFlags.Synthesized,
                kind: SyntaxKind.StringLiteral,
                text: 'array',
            }),
            name: expect.objectContaining({
                escapedText: 'type',
                flags: NodeFlags.Synthesized,
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const externalPackageTypeMatcher = {
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'pkg-external.externalType',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'type',
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const indexedNumberMatcher = {
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'object',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'type',
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.ObjectLiteralExpression,
                properties: expect.arrayContaining([
                    expect.objectContaining({
                        initializer: expect.objectContaining({
                            kind: SyntaxKind.StringLiteral,
                            text: 'any',
                        }),
                        kind: SyntaxKind.PropertyAssignment,
                        name: expect.objectContaining({
                            escapedText: 'type',
                            kind: SyntaxKind.Identifier,
                        }),
                    }),
                ]),
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'additionalProperties',
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const indexedStringMatcher = {
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'object',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'type',
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.ObjectLiteralExpression,
                properties: expect.arrayContaining([
                    expect.objectContaining({
                        initializer: expect.objectContaining({
                            kind: SyntaxKind.StringLiteral,
                            text: 'any',
                        }),
                        kind: SyntaxKind.PropertyAssignment,
                        name: expect.objectContaining({
                            escapedText: 'type',
                            kind: SyntaxKind.Identifier,
                        }),
                    }),
                ]),
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'additionalProperties',
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const interfaceMatcher = {
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            initializer: expect.objectContaining({
                elements: expect.arrayContaining([
                    expect.objectContaining({
                        kind: SyntaxKind.StringLiteral,
                        text: 'name',
                    }),
                ]),
                kind: SyntaxKind.ArrayLiteralExpression,
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'required',
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'object',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'type',
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.ObjectLiteralExpression,
                properties: expect.arrayContaining([
                    expect.objectContaining({
                        initializer: expect.objectContaining({
                            kind: SyntaxKind.ObjectLiteralExpression,
                            properties: expect.arrayContaining([
                                expect.objectContaining({
                                    initializer: expect.objectContaining({
                                        kind: SyntaxKind.StringLiteral,
                                        text: 'string',
                                    }),
                                    kind: SyntaxKind.PropertyAssignment,
                                    name: expect.objectContaining({
                                        escapedText: 'type',
                                        kind: SyntaxKind.Identifier,
                                    }),
                                }),
                                expect.objectContaining({
                                    initializer: expect.objectContaining({
                                        elements: expect.arrayContaining([
                                            expect.objectContaining({
                                                kind: SyntaxKind.NumericLiteral,
                                                text: '19',
                                            }),
                                        ]),
                                        kind: SyntaxKind.ArrayLiteralExpression,
                                    }),
                                    kind: SyntaxKind.PropertyAssignment,
                                    name: expect.objectContaining({
                                        escapedText: 'enum',
                                        kind: SyntaxKind.Identifier,
                                    }),
                                }),
                            ]),
                        }),
                        kind: SyntaxKind.PropertyAssignment,
                        name: expect.objectContaining({
                            escapedText: '"undefined"',
                            kind: SyntaxKind.Identifier,
                        }),
                    }),
                    expect.objectContaining({
                        initializer: expect.objectContaining({
                            kind: SyntaxKind.ObjectLiteralExpression,
                            properties: expect.arrayContaining([
                                expect.objectContaining({
                                    initializer: expect.objectContaining({
                                        kind: SyntaxKind.StringLiteral,
                                        text: 'string',
                                    }),
                                    kind: SyntaxKind.PropertyAssignment,
                                    name: expect.objectContaining({
                                        escapedText: 'type',
                                        kind: SyntaxKind.Identifier,
                                    }),
                                }),
                                expect.objectContaining({
                                    initializer: expect.objectContaining({
                                        elements: expect.arrayContaining([
                                            expect.objectContaining({
                                                kind: SyntaxKind.StringLiteral,
                                                text: 'string2',
                                            }),
                                        ]),
                                        kind: SyntaxKind.ArrayLiteralExpression,
                                    }),
                                    kind: SyntaxKind.PropertyAssignment,
                                    name: expect.objectContaining({
                                        escapedText: 'enum',
                                        kind: SyntaxKind.Identifier,
                                    }),
                                }),
                            ]),
                        }),
                        kind: SyntaxKind.PropertyAssignment,
                        name: expect.objectContaining({
                            escapedText: '"undefined"',
                            kind: SyntaxKind.Identifier,
                        }),
                    }),
                ]),
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'properties',
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const literalMatcher = {
    flags: TypeFlags.Boolean,
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            flags: TypeFlags.Boolean,
            kind: SyntaxKind.PropertyAssignment,
            initializer: expect.objectContaining({
                flags: TypeFlags.Boolean,
                text: 'string',
                kind: SyntaxKind.StringLiteral,
            }),
            name: expect.objectContaining({
                escapedText: 'type',
                flags: TypeFlags.Boolean,
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            flags: TypeFlags.Boolean,
            kind: SyntaxKind.PropertyAssignment,
            initializer: expect.objectContaining({
                flags: TypeFlags.Boolean,
                kind: SyntaxKind.ArrayLiteralExpression,
                elements: expect.arrayContaining([
                    expect.objectContaining({
                        kind: SyntaxKind.NumericLiteral,
                    }),
                ]),
            }),
            name: expect.objectContaining({
                escapedText: 'enum',
                flags: TypeFlags.Boolean,
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const literalWithoutValueMatcher = {
    kind: SyntaxKind.ObjectLiteralExpression,
    flags: TypeFlags.Boolean,
    properties: expect.arrayContaining([
        expect.objectContaining({
            flags: TypeFlags.Boolean,
            kind: SyntaxKind.PropertyAssignment,
            initializer: expect.objectContaining({
                flags: TypeFlags.Boolean,
                text: 'string',
                kind: SyntaxKind.StringLiteral,
            }),
            name: expect.objectContaining({
                escapedText: 'type',
                flags: TypeFlags.Boolean,
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            flags: TypeFlags.Boolean,
            kind: SyntaxKind.PropertyAssignment,
            initializer: expect.objectContaining({
                flags: TypeFlags.Boolean,
                kind: SyntaxKind.ArrayLiteralExpression,
                elements: expect.arrayContaining([
                    expect.objectContaining({
                        flags: TypeFlags.Boolean,
                        kind: SyntaxKind.TrueKeyword,
                    }),
                ]),
            }),
            name: expect.objectContaining({
                escapedText: 'enum',
                flags: TypeFlags.Boolean,
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const objectIdMatcher = {
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'string',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'type',
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const recordMatcher = {
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'object',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'type',
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.ObjectLiteralExpression,
                original: expect.objectContaining({
                    kind: SyntaxKind.ObjectLiteralExpression,
                    properties: expect.arrayContaining([
                        expect.objectContaining({
                            initializer: expect.objectContaining({
                                kind: SyntaxKind.StringLiteral,
                                text: 'string',
                            }),
                            kind: SyntaxKind.PropertyAssignment,
                            name: expect.objectContaining({
                                escapedText: 'type',
                                kind: SyntaxKind.Identifier,
                            }),
                        }),
                        expect.objectContaining({
                            initializer: expect.objectContaining({
                                elements: expect.arrayContaining([
                                    expect.objectContaining({
                                        kind: SyntaxKind.NumericLiteral,
                                        text: '17',
                                    }),
                                ]),
                                kind: SyntaxKind.ArrayLiteralExpression,
                            }),
                            kind: SyntaxKind.PropertyAssignment,
                            name: expect.objectContaining({
                                escapedText: 'enum',
                                kind: SyntaxKind.Identifier,
                            }),
                        }),
                    ]),
                }),
                properties: expect.arrayContaining([
                    expect.objectContaining({
                        initializer: expect.objectContaining({
                            kind: SyntaxKind.StringLiteral,
                            text: 'string',
                        }),
                        kind: SyntaxKind.PropertyAssignment,
                        name: expect.objectContaining({
                            escapedText: 'type',
                            kind: SyntaxKind.Identifier,
                        }),
                    }),
                    expect.objectContaining({
                        initializer: expect.objectContaining({
                            elements: expect.arrayContaining([
                                expect.objectContaining({
                                    kind: SyntaxKind.NumericLiteral,
                                    text: '17',
                                }),
                            ]),
                            kind: SyntaxKind.ArrayLiteralExpression,
                        }),
                        kind: SyntaxKind.PropertyAssignment,
                        name: expect.objectContaining({
                            escapedText: 'enum',
                            kind: SyntaxKind.Identifier,
                        }),
                    }),
                    expect.objectContaining({
                        initializer: expect.objectContaining({
                            kind: SyntaxKind.StringLiteral,
                            text: '**Keys**: prop1 | prop2 | prop3 | prop4 | prop5 | prop6',
                        }),
                        kind: SyntaxKind.PropertyAssignment,
                        name: expect.objectContaining({
                            escapedText: 'description',
                            kind: SyntaxKind.Identifier,
                        }),
                    }),
                ]),
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'additionalProperties',
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const stringMatcher = {
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            flags: NodeFlags.Synthesized,
            kind: SyntaxKind.PropertyAssignment,
            initializer: expect.objectContaining({
                text: 'any',
                kind: SyntaxKind.StringLiteral,
            }),
            name: expect.objectContaining({
                escapedText: 'type',
                flags: NodeFlags.Synthesized,
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}

export const tupleMatcher = {
    kind: SyntaxKind.ObjectLiteralExpression,
    properties: expect.arrayContaining([
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'object',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'type',
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.ObjectLiteralExpression,
                properties: expect.arrayContaining([
                    expect.objectContaining({
                        initializer: expect.objectContaining({
                            kind: SyntaxKind.ObjectLiteralExpression,
                            properties: expect.arrayContaining([
                                expect.objectContaining({
                                    initializer: expect.objectContaining({
                                        kind: SyntaxKind.StringLiteral,
                                        text: 'any',
                                    }),
                                    kind: SyntaxKind.PropertyAssignment,
                                    name: expect.objectContaining({
                                        escapedText: 'type',
                                        kind: SyntaxKind.Identifier,
                                    }),
                                }),
                            ]),
                        }),
                        kind: SyntaxKind.PropertyAssignment,
                        name: expect.objectContaining({
                            escapedText: '0',
                            kind: SyntaxKind.Identifier,
                        }),
                    }),
                    expect.objectContaining({
                        initializer: expect.objectContaining({
                            kind: SyntaxKind.ObjectLiteralExpression,
                            properties: expect.arrayContaining([
                                expect.objectContaining({
                                    initializer: expect.objectContaining({
                                        kind: SyntaxKind.StringLiteral,
                                        text: 'string',
                                    }),
                                    kind: SyntaxKind.PropertyAssignment,
                                    name: expect.objectContaining({
                                        escapedText: 'type',
                                        kind: SyntaxKind.Identifier,
                                    }),
                                }),
                                expect.objectContaining({
                                    initializer: expect.objectContaining({
                                        elements: expect.arrayContaining([
                                            expect.objectContaining({
                                                kind: SyntaxKind.StringLiteral,
                                                text: false,
                                            }),
                                        ]),
                                    }),
                                    kind: SyntaxKind.PropertyAssignment,
                                    name: expect.objectContaining({
                                        escapedText: 'enum',
                                        kind: SyntaxKind.Identifier,
                                    }),
                                }),
                            ]),
                        }),
                        kind: SyntaxKind.PropertyAssignment,
                        name: expect.objectContaining({
                            escapedText: '1',
                            kind: SyntaxKind.Identifier,
                        }),
                    }),
                ]),
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'properties',
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: SyntaxKind.StringLiteral,
                text: 'This is array response (tuple type)',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'description',
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: 9,
                text: '2',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'minItems',
                kind: SyntaxKind.Identifier,
            }),
        }),
        expect.objectContaining({
            initializer: expect.objectContaining({
                kind: 9,
                text: '2',
            }),
            kind: SyntaxKind.PropertyAssignment,
            name: expect.objectContaining({
                escapedText: 'maxItems',
                kind: SyntaxKind.Identifier,
            }),
        }),
    ]),
}
