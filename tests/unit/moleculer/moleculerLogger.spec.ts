import { Loggers } from 'moleculer'

const kleur = { enabled: true }

jest.mock('kleur', () => kleur)

import Logger from '@diia-inhouse/diia-logger'
import { mockInstance } from '@diia-inhouse/test'

import MoleculerLogger from '../../../src/moleculer/moleculerLogger'

describe(`${MoleculerLogger.constructor.name}`, () => {
    const logger = mockInstance(Logger)

    const moleculerLogger = new MoleculerLogger(logger)

    describe(`method ${moleculerLogger.getLogHandler.name}`, () => {
        const logHandler = <Loggers.LogHandler>moleculerLogger.getLogHandler()

        it('should successfully get log handler and invoke log method when no message', () => {
            logHandler('trace', ['', undefined])

            expect(logger.trace).not.toHaveBeenCalled()
        })

        it('should successfully get log handler and invoke log method when only message', () => {
            logHandler('trace', <[string, unknown]>(<unknown>['trace message']))

            expect(logger.trace).toHaveBeenCalledWith('trace message')
        })

        it('should successfully get log handler and invoke log method when message with data', () => {
            logHandler('trace', ['trace message', {}])

            expect(logger.trace).toHaveBeenCalledWith('trace message', { data: {} })
        })
    })

    describe(`method ${moleculerLogger.resetColors.name}`, () => {
        it('should successfully reset colors', () => {
            kleur.enabled = true

            moleculerLogger.resetColors()

            expect(kleur.enabled).toBeFalsy()
        })
    })
})
