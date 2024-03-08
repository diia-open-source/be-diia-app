import ts from 'typescript'

import { Env } from '@diia-inhouse/env'

import openApiPlugin from '../../../../src/plugins/openapi'
import ActionVisitor from '../../../../src/plugins/openapi/actionVisitor'

jest.mock('../../../../src/plugins/openapi/actionVisitor')

describe('OpenApi plugin', () => {
    it('should call action visitor', () => {
        process.env.NODE_ENV = Env.Stage

        const sourceFile = { fileName: 'dist/src/actions/action.js' }
        const ctx = {}
        const program = {}

        jest.spyOn(ActionVisitor, 'visit').mockReturnValueOnce(<ReturnType<typeof ts.visitNode>>(<unknown>sourceFile))

        const result = openApiPlugin(<ts.Program>program)(ctx)(sourceFile)

        expect(ActionVisitor.visit).toHaveBeenCalledWith(sourceFile, ctx, program)
        expect(result).toBe(sourceFile)
    })

    it('should not call action visitor if source file is not an action', () => {
        process.env.NODE_ENV = Env.Stage

        const sourceFile = { fileName: 'dist/src/providers/action.js' }
        const ctx = {}
        const program = {}

        const result = openApiPlugin(<ts.Program>program)(ctx)(sourceFile)

        expect(ActionVisitor.visit).toHaveBeenCalledTimes(0)
        expect(result).toBe(sourceFile)
    })

    it('should not call action visitor if env is prod', () => {
        process.env.NODE_ENV = Env.Prod

        const sourceFile = { fileName: 'dist/src/actions/action.js' }
        const ctx = {}
        const program = {}

        const result = openApiPlugin(<ts.Program>program)(ctx)(sourceFile)

        expect(ActionVisitor.visit).toHaveBeenCalledTimes(0)
        expect(result).toBe(sourceFile)
    })
})
