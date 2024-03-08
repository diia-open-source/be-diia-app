import kleur from 'kleur'
import { LogLevels, Loggers } from 'moleculer'

import { LogLevel, Logger } from '@diia-inhouse/types'

export default class MoleculerLogger extends Loggers.Base {
    private readonly brokerLogLevelsMap: Record<LogLevels, LogLevel> = {
        fatal: LogLevel.FATAL,
        error: LogLevel.ERROR,
        warn: LogLevel.WARN,
        info: LogLevel.INFO,
        debug: LogLevel.DEBUG,
        trace: LogLevel.TRACE,
    }

    constructor(private logger: Logger) {
        super()

        this.resetColors()
    }

    getLogHandler(): Loggers.LogHandler | null {
        return (type: LogLevels, argParams: unknown[]): void => {
            const level: LogLevel = this.brokerLogLevelsMap[type]
            const [msg, ...args] = argParams
            if (!msg || typeof msg !== 'string') {
                return
            }

            if (args.length) {
                let data: unknown = args
                if (args.length === 1) {
                    data = args[0]
                }

                this.logger[level](msg, { data })

                return
            }

            this.logger[level](msg)
        }
    }

    resetColors(): void {
        const colorizer = kleur

        colorizer.enabled = false
    }
}
