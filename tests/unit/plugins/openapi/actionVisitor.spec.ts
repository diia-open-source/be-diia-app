import ts from 'typescript'

import { ACTION_RESPONSE } from '../../../../src'
import ActionVisitor from '../../../../src/plugins/openapi/actionVisitor'

vi.mock('../../../../src/plugins/openapi/parser')
vi.mock('typescript', async (importOriginal) => {
    const original = await importOriginal<typeof import('typescript')>()

    return {
        ...original,
        default: {
            visitEachChild: vi.fn(),
            getModifiers: vi.fn(),
            isClassDeclaration: vi.fn().mockReturnValueOnce(true),
            // isClassDeclaration: (): boolean => true,
            isMethodDeclaration: (): boolean => true,
            visitNode: (node: unknown, visitClassNode: (node: unknown) => void): void => {
                visitClassNode(node)
            },
        },
    }
})

const programMock = {
    getTypeChecker(): {
        getSignatureFromDeclaration: () => boolean
        getReturnTypeOfSignature: () => { symbol: { getName: () => string } }
    } {
        return {
            getSignatureFromDeclaration(): boolean {
                return true
            },
            getReturnTypeOfSignature(): { symbol: { getName: () => string } } {
                return {
                    symbol: {
                        getName(): string {
                            return 'name'
                        },
                    },
                }
            },
        }
    },
}
const transformationContextMock = {
    factory: {
        createIdentifier: vi.fn(),
        createPropertyDeclaration: vi.fn(),
        updateClassDeclaration: vi.fn(),
    },
}

describe(`OpenApi ActionVisitor`, () => {
    describe(`method ${ActionVisitor.visit.name}`, () => {
        const nodeWithHandler = {
            members: [
                {
                    name: {
                        getText(): string {
                            return 'handler'
                        },
                    },
                },
            ],
        }

        it('should update class declaration', () => {
            vi.spyOn(ts, 'isClassDeclaration').mockReturnValueOnce(true).mockReturnValueOnce(true)

            ActionVisitor.visit(
                nodeWithHandler as unknown as ts.SourceFile,
                transformationContextMock as unknown as ts.TransformationContext,
                programMock as unknown as ts.Program,
            )

            expect(transformationContextMock.factory.createIdentifier).toHaveBeenCalledWith(ACTION_RESPONSE)
            expect(transformationContextMock.factory.createPropertyDeclaration).toHaveBeenCalled()
            expect(transformationContextMock.factory.updateClassDeclaration).toHaveBeenCalled()
        })

        it('should visit each child if handler method was not found', () => {
            const node = {
                members: [
                    {
                        name: {
                            getText(): string {
                                return 'name'
                            },
                        },
                    },
                ],
            }

            ActionVisitor.visit(
                node as unknown as ts.SourceFile,
                transformationContextMock as unknown as ts.TransformationContext,
                programMock as unknown as ts.Program,
            )

            expect(ts.visitEachChild).toHaveBeenCalled()
        })

        it('should visit each child if signature was not found', () => {
            vi.spyOn(programMock, 'getTypeChecker').mockReturnValueOnce({
                getSignatureFromDeclaration(): boolean {
                    return false
                },
                getReturnTypeOfSignature(): { symbol: { getName: () => string } } {
                    return {
                        symbol: {
                            getName(): string {
                                return 'name'
                            },
                        },
                    }
                },
            })

            ActionVisitor.visit(
                nodeWithHandler as unknown as ts.SourceFile,
                transformationContextMock as unknown as ts.TransformationContext,
                programMock as unknown as ts.Program,
            )

            expect(ts.visitEachChild).toHaveBeenCalled()
        })

        it('should visit each child if response type arguments not found', () => {
            vi.spyOn(programMock, 'getTypeChecker').mockReturnValueOnce({
                getSignatureFromDeclaration(): boolean {
                    return true
                },
                getReturnTypeOfSignature(): { symbol: { getName: () => string }; typeArguments: unknown[] } {
                    return {
                        symbol: {
                            getName(): string {
                                return 'Promise'
                            },
                        },
                        typeArguments: [],
                    }
                },
            })

            ActionVisitor.visit(
                nodeWithHandler as unknown as ts.SourceFile,
                transformationContextMock as unknown as ts.TransformationContext,
                programMock as unknown as ts.Program,
            )

            expect(ts.visitEachChild).toHaveBeenCalled()
        })

        it('should visit each child if node is not a class declaration', () => {
            vi.spyOn(ts, 'isClassDeclaration').mockReturnValueOnce(false)

            ActionVisitor.visit(
                nodeWithHandler as unknown as ts.SourceFile,
                transformationContextMock as unknown as ts.TransformationContext,
                programMock as unknown as ts.Program,
            )

            expect(ts.visitEachChild).toHaveBeenCalled()
        })
    })
})
