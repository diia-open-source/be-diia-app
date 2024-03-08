import ts from 'typescript'

import { ACTION_RESPONSE } from '../pluginConstants'

import parser from './parser'

export default class ActionVisitor {
    static visit(sourceFile: ts.SourceFile, ctx: ts.TransformationContext, program: ts.Program): ReturnType<typeof ts.visitNode> {
        const typeChecker = program.getTypeChecker()

        const visitClassNode = (node: ts.Node): ts.Node => {
            if (ts.isClassDeclaration(node)) {
                const classMethods = <ts.MethodDeclaration[]>node.members.filter((member) => ts.isMethodDeclaration(member))

                const handlerMethod = classMethods.find((classMethod) => classMethod.name.getText() === 'handler')

                if (!handlerMethod) {
                    return ts.visitEachChild(node, visitClassNode, ctx)
                }

                const signature = typeChecker.getSignatureFromDeclaration(handlerMethod)

                if (!signature) {
                    return ts.visitEachChild(node, visitClassNode, ctx)
                }

                const type = typeChecker.getReturnTypeOfSignature(signature)

                const responseType = type.symbol.getName() === 'Promise' ? (<ts.GenericType>type)?.typeArguments?.[0] : type

                if (!responseType) {
                    return ts.visitEachChild(node, visitClassNode, ctx)
                }

                const handlerResponse: ts.ObjectLiteralExpression = parser.parseType(responseType, program)

                return this.addResponseFactory(ctx.factory, node, handlerResponse)
            }

            return ts.visitEachChild(node, visitClassNode, ctx)
        }

        return ts.visitNode(sourceFile, visitClassNode)
    }

    static addResponseFactory(
        factory: ts.NodeFactory,
        node: ts.ClassDeclaration,
        handlerResponse: ts.ObjectLiteralExpression,
    ): ts.ClassDeclaration {
        const property = factory.createPropertyDeclaration(
            undefined,
            factory.createIdentifier(ACTION_RESPONSE),
            undefined,
            undefined,
            handlerResponse,
        )

        return factory.updateClassDeclaration(node, ts.getModifiers(node), node.name, node.typeParameters, node.heritageClauses, [
            ...node.members,
            property,
        ])
    }
}
