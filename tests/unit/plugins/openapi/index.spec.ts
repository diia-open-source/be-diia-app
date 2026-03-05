import ts from 'typescript'

import { Env } from '@diia-inhouse/env'

import openApiPlugin from '../../../../src/plugins/openapi'
import ActionVisitor from '../../../../src/plugins/openapi/actionVisitor'

vi.mock('../../../../src/plugins/openapi/actionVisitor')

describe('OpenApi plugin', () => {
    it('should call action visitor', () => {
        process.env.NODE_ENV = Env.Stage

        const sourceFile = { fileName: 'dist/src/actions/action.js' }
        const ctx = {}
        const program = {}

        vi.spyOn(ActionVisitor, 'visit').mockReturnValueOnce(sourceFile as unknown as ReturnType<typeof ts.visitNode>)

        const result = openApiPlugin(program as ts.Program)(ctx)(sourceFile)

        expect(ActionVisitor.visit).toHaveBeenCalledWith(sourceFile, ctx, program)
        expect(result).toBe(sourceFile)
    })

    it('should not call action visitor if source file is not an action', () => {
        process.env.NODE_ENV = Env.Stage

        const sourceFile = { fileName: 'dist/src/providers/action.js' }
        const ctx = {}
        const program = {}

        vi.spyOn(ActionVisitor, 'visit')

        const result = openApiPlugin(program as ts.Program)(ctx)(sourceFile)

        expect(ActionVisitor.visit).toHaveBeenCalledTimes(0)
        expect(result).toBe(sourceFile)
    })

    it('should not call action visitor if env is prod', () => {
        process.env.NODE_ENV = Env.Prod

        const sourceFile = { fileName: 'dist/src/actions/action.js' }
        const ctx = {}
        const program = {}

        vi.spyOn(ActionVisitor, 'visit')

        const result = openApiPlugin(program as ts.Program)(ctx)(sourceFile)

        expect(ActionVisitor.visit).toHaveBeenCalledTimes(0)
        expect(result).toBe(sourceFile)
    })
})
