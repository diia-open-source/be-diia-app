import { config } from 'dotenv-flow'

config({ silent: true })

export { AwilixContainer, Constructor, Lifetime, asClass, asFunction, asValue, NameAndRegistrationPair, listModules } from 'awilix'

export * from '@opentelemetry/api'

export * from '@opentelemetry/semantic-conventions'

export * from './application'

export * from './interfaces'

export * from './interfaces/deps'

export * from './interfaces/application'

export * from './grpc'

export * from './plugins/pluginConstants'

export * from './tracing'

export * from './actionExecutor'

export { default as MoleculerService } from './moleculer/moleculerWrapper'
