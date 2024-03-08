import ts from 'typescript'

import { ACTION_RESPONSE } from '../../../../src'
import ActionVisitor from '../../../../src/plugins/openapi/actionVisitor'

jest.mock('../../../../src/plugins/openapi/parser')
jest.mock('typescript', () => {
    const mocked = <Record<string, unknown>>jest.createMockFromModule('typescript')
    const isMethodDeclaration = (): boolean => true
    const isClassDeclaration = (): boolean => true
    const visitNode = (node: unknown, visitClassNode: (node: unknown) => void): void => {
        visitClassNode(node)
    }

    return {
        ...mocked,
        visitEachChild: jest.fn(),
        getModifiers: jest.fn(),
        isClassDeclaration,
        isMethodDeclaration,
        visitNode,
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
        createIdentifier: jest.fn(),
        createPropertyDeclaration: jest.fn(),
        updateClassDeclaration: jest.fn(),
    },
}

describe(`OpenApi ${ActionVisitor.name}`, () => {
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
            ActionVisitor.visit(
                <ts.SourceFile>(<unknown>nodeWithHandler),
                <ts.TransformationContext>(<unknown>transformationContextMock),
                <ts.Program>(<unknown>programMock),
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
                <ts.SourceFile>(<unknown>node),
                <ts.TransformationContext>(<unknown>transformationContextMock),
                <ts.Program>(<unknown>programMock),
            )

            expect(ts.visitEachChild).toHaveBeenCalled()
        })

        it('should visit each child if signature was not found', () => {
            jest.spyOn(programMock, 'getTypeChecker').mockReturnValueOnce({
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
                <ts.SourceFile>(<unknown>nodeWithHandler),
                <ts.TransformationContext>(<unknown>transformationContextMock),
                <ts.Program>(<unknown>programMock),
            )

            expect(ts.visitEachChild).toHaveBeenCalled()
        })

        it('should visit each child if response type arguments not found', () => {
            jest.spyOn(programMock, 'getTypeChecker').mockReturnValueOnce({
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
                <ts.SourceFile>(<unknown>nodeWithHandler),
                <ts.TransformationContext>(<unknown>transformationContextMock),
                <ts.Program>(<unknown>programMock),
            )

            expect(ts.visitEachChild).toHaveBeenCalled()
        })

        it('should visit each child if node is not a class declaration', () => {
            jest.spyOn(ts, 'isClassDeclaration').mockReturnValueOnce(false)

            ActionVisitor.visit(
                <ts.SourceFile>(<unknown>nodeWithHandler),
                <ts.TransformationContext>(<unknown>transformationContextMock),
                <ts.Program>(<unknown>programMock),
            )

            expect(ts.visitEachChild).toHaveBeenCalled()
        })
    })
})
