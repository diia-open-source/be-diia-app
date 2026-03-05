/* eslint-disable @typescript-eslint/no-explicit-any */
import * as dotenv from 'dotenv-flow'
// eslint-disable-next-line import/no-extraneous-dependencies, n/no-unpublished-import
import * as ts from 'typescript'

import { Env } from '@diia-inhouse/env'

import ActionVisitor from './actionVisitor'

dotenv.config({ silent: true })

const defaultActionsDir = 'src/actions/'

function before(program: ts.Program): ts.Transformer<any> {
    return (ctx: ts.TransformationContext): ts.Transformer<any> => {
        return (sf: ts.SourceFile): ReturnType<typeof ts.visitNode> => {
            const isAction: boolean = sf.fileName.includes(defaultActionsDir)
            if (isAction) {
                return ActionVisitor.visit(sf, ctx, program)
            }

            return sf
        }
    }
}

// eslint-disable-next-line unicorn/consistent-function-scoping
const transformer = (): ts.Transformer<ts.SourceFile> => (sf) => sf

export default function (program: ts.Program): ts.Transformer<any> {
    return process.env.NODE_ENV === Env.Prod ? transformer : before(program)
}
