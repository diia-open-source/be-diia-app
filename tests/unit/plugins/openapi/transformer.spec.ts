import ts from 'typescript'

import openApiPlugin from '../../../../src/plugins/openapi'

const actionsDir = '/virtual/src/actions'

const packages = {
    '/virtual/node_modules/pkg-external/index.d.ts': 'export interface Money { amount: number }',
    '/virtual/node_modules/@diia-inhouse/fixture/index.d.ts': 'export interface Doc { title: string }',
}

const actions = {
    nullProperty:
        'export default class { async handler(): Promise<{ id: string; deletedAt: null }> { return { id: "", deletedAt: null } } }',
    syncVoid: 'export default class { handler(): void {} }',
    literals: `
        enum Code { NotFound = 404, Gone = 410 }
        export default class {
            async handler(): Promise<{ status: 404; ok: true; kind: 'a'; sizes: 1 | 2; code: Code; debt: -1n }> {
                return { status: 404, ok: true, kind: 'a', sizes: 1, code: Code.NotFound, debt: -1n }
            }
        }`,
    literalKeys: `
        export default class {
            async handler(): Promise<{ title: Record<'uk' | 'en', string>; labels: Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f', number> }> {
                return { title: { uk: '', en: '' }, labels: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 } }
            }
        }`,
    intersection: `
        interface Base { id: string; 'x-trace'?: string }
        export default class {
            async handler(): Promise<Base & { count?: number; name: string; id: string }> { return { id: '', name: '' } }
        }`,
    untyped: `
        export default class {
            async handler(): Promise<{ anything: any; unknown: unknown; big: bigint; ref: \`doc-\${string}\` }> {
                return { anything: 1, unknown: 1, big: 1n, ref: 'doc-1' }
            }
        }`,
    packages: `
        import type { Money } from 'pkg-external'
        import type { Doc } from '@diia-inhouse/fixture'
        export default class {
            async handler(): Promise<{ price: Money; doc: Doc }> {
                return {} as never
            }
        }`,
    shapes: `
        declare class ObjectId {}
        declare class Buffer {}
        enum Kind { A = 'a', B = 'b' }
        interface Cat { meows: boolean }
        interface Dog { barks: boolean }
        export default class {
            async handler(): Promise<{
                name: string
                count: number
                flag: boolean
                items: string[]
                pair: [string, boolean]
                id: ObjectId
                at: Date
                file: Buffer
                byIndex: { [index: number]: string }
                byKey: Record<string, number>
                kind: Kind
                note: string | null
                pet: Cat | Dog
                /**
                 * Document number
                 * @example 42
                 */
                number?: number
            }> {
                return {} as never
            }
        }`,
}

const compileActionResponses = (): Record<keyof typeof actions, unknown> => {
    const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        lib: ['lib.es2022.d.ts'],
        types: [],
        strict: true,
        skipLibCheck: true,
    }
    const actionFiles = Object.keys(actions).map((name) => `${actionsDir}/${name}.ts`)
    const sources = new Map<string, string>([
        ...Object.entries(packages),
        ...Object.entries(actions).map(([name, source]): [string, string] => [`${actionsDir}/${name}.ts`, source]),
    ])
    const defaultHost = ts.createCompilerHost(options)
    const host: ts.CompilerHost = {
        ...defaultHost,
        getSourceFile: (fileName, languageVersion, ...rest): ts.SourceFile | undefined => {
            const source = sources.get(fileName)

            return source === undefined
                ? defaultHost.getSourceFile(fileName, languageVersion, ...rest)
                : ts.createSourceFile(fileName, source, languageVersion)
        },
        fileExists: (fileName): boolean => sources.has(fileName) || defaultHost.fileExists(fileName),
        readFile: (fileName): string | undefined => sources.get(fileName) ?? defaultHost.readFile(fileName),
        directoryExists: (directoryName): boolean =>
            directoryName.startsWith('/virtual') || (defaultHost.directoryExists?.(directoryName) ?? false),
    }

    const program = ts.createProgram(actionFiles, options, host)
    const errors = ts.getPreEmitDiagnostics(program).map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, '\n'))
    if (errors.length > 0) {
        throw new Error(errors.join('\n'))
    }

    const emitted = new Map<string, string>()

    program.emit(undefined, (fileName, text) => emitted.set(fileName, text), undefined, false, { before: [openApiPlugin(program)] })

    return Object.fromEntries(
        Object.keys(actions).map((name) => {
            const module = { exports: {} as { default: new () => { __actionResponse?: unknown } } }

            new Function('module', 'exports', emitted.get(`${actionsDir}/${name}.js`) ?? '')(module, module.exports)
            const response = new module.exports.default().__actionResponse

            return [name, response === undefined ? undefined : JSON.parse(JSON.stringify(response))]
        }),
    ) as Record<keyof typeof actions, unknown>
}

describe('OpenAPI transformer', () => {
    let responses: Record<keyof typeof actions, unknown>

    beforeAll(() => {
        responses = compileActionResponses()
    })

    it.each([
        {
            action: 'nullProperty' as const,
            expected: {
                type: 'object',
                required: ['id', 'deletedAt'],
                properties: { id: { type: 'string' }, deletedAt: { type: 'null' } },
            },
        },
        { action: 'syncVoid' as const, expected: undefined },
        {
            action: 'literals' as const,
            expected: {
                type: 'object',
                required: ['status', 'ok', 'kind', 'sizes', 'code', 'debt'],
                properties: {
                    status: { type: 'number', enum: [404] },
                    ok: { type: 'boolean', enum: [true] },
                    kind: { type: 'string', enum: ['a'] },
                    sizes: { type: 'number', enum: [1, 2] },
                    code: { type: 'number', enum: [404, 410] },
                    debt: { type: 'integer', enum: [-1] },
                },
            },
        },
        {
            action: 'literalKeys' as const,
            expected: {
                type: 'object',
                required: ['title', 'labels'],
                properties: {
                    title: { type: 'object', required: ['uk', 'en'], properties: { uk: { type: 'string' }, en: { type: 'string' } } },
                    labels: { type: 'object', additionalProperties: { type: 'number', description: '**Keys**: a | b | c | d | e | f' } },
                },
            },
        },
        {
            action: 'intersection' as const,
            expected: {
                type: 'object',
                required: ['name', 'id'],
                properties: { count: { type: 'number' }, name: { type: 'string' }, id: { type: 'string' }, 'x-trace': { type: 'string' } },
            },
        },
        {
            action: 'untyped' as const,
            expected: {
                type: 'object',
                required: ['anything', 'unknown', 'big', 'ref'],
                properties: { anything: {}, unknown: {}, big: { type: 'integer' }, ref: { type: 'string' } },
            },
        },
        {
            action: 'packages' as const,
            expected: {
                type: 'object',
                required: ['price', 'doc'],
                properties: {
                    price: { type: 'pkg-external.Money' },
                    doc: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
                },
            },
        },
        {
            action: 'shapes' as const,
            expected: {
                type: 'object',
                required: ['name', 'count', 'flag', 'items', 'pair', 'id', 'at', 'file', 'byIndex', 'byKey', 'kind', 'note', 'pet'],
                properties: {
                    name: { type: 'string' },
                    count: { type: 'number' },
                    flag: { type: 'boolean' },
                    items: { type: 'array', items: { type: 'string' } },
                    pair: {
                        type: 'object',
                        properties: { 0: { type: 'string' }, 1: { type: 'boolean' } },
                        description: 'This is array response (tuple type)',
                        minItems: 2,
                        maxItems: 2,
                    },
                    id: { type: 'string' },
                    at: { type: 'string', format: 'date-time' },
                    file: { type: 'string', format: 'binary' },
                    byIndex: { type: 'object', additionalProperties: { type: 'string' } },
                    byKey: { type: 'object', additionalProperties: { type: 'number' } },
                    kind: { type: 'string', enum: ['a', 'b'] },
                    note: { type: ['null', 'string'] },
                    pet: {
                        anyOf: [
                            { type: 'object', required: ['meows'], properties: { meows: { type: 'boolean' } }, title: 'Cat' },
                            { type: 'object', required: ['barks'], properties: { barks: { type: 'boolean' } }, title: 'Dog' },
                        ],
                    },
                    number: { type: 'number', description: 'Document number', example: 42 },
                },
            },
        },
    ])('should describe the response of $action', ({ action, expected }) => {
        expect(responses[action]).toEqual(expected)
    })
})
