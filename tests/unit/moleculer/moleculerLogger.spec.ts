import { Loggers } from 'moleculer'
import { mock } from 'vitest-mock-extended'

import Logger from '@diia-inhouse/diia-logger'

import MoleculerLogger from '../../../src/moleculer/moleculerLogger'

describe(`${MoleculerLogger.constructor.name}`, () => {
    const logger = mock<Logger>()

    const moleculerLogger = new MoleculerLogger(logger)

    describe(`method ${moleculerLogger.getLogHandler.name}`, () => {
        const logHandler = moleculerLogger.getLogHandler() as Loggers.LogHandler

        it('should successfully get log handler and invoke log method when no message', () => {
            logHandler('trace', ['', undefined])

            expect(logger.trace).not.toHaveBeenCalled()
        })

        it('should successfully get log handler and invoke log method when only message', () => {
            logHandler('trace', ['trace message'] as unknown as [string, unknown])

            expect(logger.trace).toHaveBeenCalledWith('trace message')
        })

        it('should successfully get log handler and invoke log method when message with data', () => {
            logHandler('trace', ['trace message', {}])

            expect(logger.trace).toHaveBeenCalledWith('trace message', { data: {} })
        })
    })
})
