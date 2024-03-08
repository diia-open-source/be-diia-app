/* eslint-disable @typescript-eslint/no-var-requires */
import { AsyncLocalStorage } from 'async_hooks'
import path from 'path'

import { AwilixContainer, InjectionMode, Lifetime, NameAndRegistrationPair, asClass, asValue, createContainer, listModules } from 'awilix'
import { NameFormatter } from 'awilix/lib/load-modules'
import { camelCase, upperFirst } from 'lodash'
import { singular } from 'pluralize'
import { Class } from 'type-fest'

import { Counter, MetricsService } from '@diia-inhouse/diia-metrics'
import type { Queue } from '@diia-inhouse/diia-queue'
import { EnvService } from '@diia-inhouse/env'
import {
    AlsData,
    Logger,
    LoggerConstructor,
    OnBeforeApplicationShutdown,
    OnDestroy,
    OnInit,
    OnRegistrationsFinished,
} from '@diia-inhouse/types'
import { guards } from '@diia-inhouse/utils'
import { AppValidator } from '@diia-inhouse/validators'

import ActionFactory from './actionFactory'
import { GrpcService } from './grpc'
import { GrpcClientFactory } from './grpc/grpcClient'
import {
    ConfigFactoryFn,
    ConfigType,
    DepsFactoryFn,
    DepsType,
    LoadDepsFromFolderOptions,
    ServiceContext,
    ServiceOperator,
} from './interfaces/application'
import { BaseConfig } from './interfaces/config'
import { BaseDeps } from './interfaces/deps'
import MoleculerService from './moleculer/moleculerWrapper'
import PluginDepsCollection from './pluginDepsCollection'

export class Application<TContext extends ServiceContext> {
    private config?: BaseConfig & ConfigType<TContext>

    private deps?: NameAndRegistrationPair<BaseDeps & DepsType<TContext>>

    private container: AwilixContainer<BaseDeps & DepsType<TContext>>

    private groupedDepsNames: Record<string, string[]> = {}

    private groupedPluginDepsNames: Record<string, string[]> = {}

    private syncCommunicationClasses = [MoleculerService, GrpcService]

    private asyncCommunicationClasses: Class<OnInit>[] = []

    constructor(
        private readonly serviceName: string,
        loggerPkg = '@diia-inhouse/diia-logger',
    ) {
        this.container = createContainer<BaseDeps & DepsType<TContext>>({ injectionMode: InjectionMode.CLASSIC, strict: true }).register({
            serviceName: asValue(this.serviceName),
            envService: asClass(EnvService).singleton(),
            logger: asClass(<LoggerConstructor>require(loggerPkg).default, {
                injector: () => ({ options: { logLevel: process.env.LOG_LEVEL } }),
            }).singleton(),
            asyncLocalStorage: asValue(new AsyncLocalStorage<AlsData>()),
        })
    }

    async setConfig(factory: ConfigFactoryFn<ConfigType<TContext>>): Promise<this> {
        const envService = this.container.resolve<EnvService>('envService')

        await envService.init()
        this.config = await factory(envService, this.serviceName)

        return this
    }

    patchConfig(config: Partial<BaseConfig & ConfigType<TContext>>): void {
        if (!this.config) {
            throw new Error('Config should be set before patch')
        }

        Object.assign(this.config, config)
    }

    setDeps(factory: DepsFactoryFn<BaseConfig & ConfigType<TContext>, DepsType<TContext>>): this {
        if (!this.config) {
            throw new Error('Config should be set before deps')
        }

        this.deps = factory(this.config)

        return this
    }

    initialize(): ServiceOperator<ConfigType<TContext>, DepsType<TContext>> {
        this.setOnShutDownHook()

        const baseDeps = this.getBaseDeps()
        const mergedDeps = <NameAndRegistrationPair<BaseDeps & DepsType<TContext>>>{
            ...baseDeps,
            ...this.deps,
        }

        this.container.register(mergedDeps)
        this.loadDefaultDepsFolders()

        const ctx = this.createContext()

        return {
            ...ctx,
            start: this.start.bind(this),
            stop: this.stop.bind(this),
        }
    }

    overrideDeps(overriddenDeps: NameAndRegistrationPair<BaseDeps & DepsType<TContext>>): this {
        this.deps = { ...this.deps, ...overriddenDeps }

        return this
    }

    defaultNameFormatter(folderName: string): NameFormatter {
        return (_, descriptor) => {
            const parsedPath = path.parse(descriptor.path)
            const fileName = parsedPath.name
            const dependencyPath = parsedPath.dir
                .split(`dist/${folderName}`)[1]
                .split(path.sep)
                .map((p) => upperFirst(p))

            if (fileName !== 'index') {
                dependencyPath.push(upperFirst(fileName))
            }

            const dependencyType = upperFirst(singular(folderName))

            return camelCase(`${dependencyPath.join('')}${dependencyType}`)
        }
    }

    loadDepsFromFolder(options: LoadDepsFromFolderOptions): this {
        const {
            folderName,
            fileMask = '**/*.js',
            nameFormatter = this.defaultNameFormatter(folderName),
            resolverOptions = { lifetime: Lifetime.SINGLETON },
            pluginGroupName,
            groupName,
        } = options

        const directory = `dist/${folderName}/${fileMask}`
        const modules = listModules(directory)

        if (pluginGroupName) {
            if (!Object.keys(this.container.registrations).includes(pluginGroupName)) {
                this.container.register(pluginGroupName, asClass(PluginDepsCollection).singleton())
            }

            this.groupedPluginDepsNames[pluginGroupName] = this.groupedPluginDepsNames[pluginGroupName] || []
        }

        if (groupName) {
            if (!Object.keys(this.container.registrations).includes(groupName)) {
                this.container.register(groupName, asValue([]))
            }

            this.groupedDepsNames[groupName] = this.groupedDepsNames[groupName] || []
        }

        modules.forEach((module) => {
            const { name, path: modulePath } = module
            const registrationName = nameFormatter(name, { ...module, value: '' })
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const dependency = require(path.resolve(modulePath)).default

            if (dependency) {
                this.container.register(registrationName, asClass(dependency, resolverOptions))

                if (pluginGroupName) {
                    this.groupedPluginDepsNames[pluginGroupName].push(registrationName)
                }

                if (groupName) {
                    this.groupedDepsNames[groupName].push(registrationName)
                }
            }
        })

        return this
    }

    private getBaseDeps(): NameAndRegistrationPair<BaseDeps> {
        const { config } = this
        if (!config && typeof config !== 'object') {
            throw new Error('Config should be set before using [getBaseDeps]')
        }

        const { isMoleculerEnabled } = config

        let redisDeps = {}
        if (config.store || config.redis) {
            const { CacheService, PubSubService, RedlockService, StoreService } = require('@diia-inhouse/redis')

            redisDeps = {
                ...(config.store && {
                    store: asClass(StoreService, { injector: () => ({ storeConfig: config.store }) }).singleton(),
                    redlock: asClass(RedlockService, { injector: () => ({ storeConfig: config.store }) }).singleton(),
                }),
                ...(config.redis && {
                    cache: asClass(CacheService, { injector: () => ({ redisConfig: config.redis }) }).singleton(),
                    pubsub: asClass(PubSubService, { injector: () => ({ redisConfig: config.redis }) }).singleton(),
                }),
            }
        }

        let queueDeps = {}
        if ('rabbit' in config) {
            const {
                ExternalCommunicator,
                ExternalCommunicatorChannel,
                ExternalEventBus,
                ScheduledTask,
                Queue,
                EventMessageHandler,
                EventMessageValidator,
                EventBus,
                Task,
                QueueConnectionType,
            } = require('@diia-inhouse/diia-queue')

            this.asyncCommunicationClasses.push(ExternalCommunicator, ExternalEventBus, ScheduledTask, EventBus, Task)

            const baseQueueDeps = {
                queue: asClass(Queue, { injector: () => ({ connectionConfig: config.rabbit }) }).singleton(),
                eventMessageHandler: asClass(EventMessageHandler).singleton(),
                eventMessageValidator: asClass(EventMessageValidator).singleton(),
                externalChannel: asClass(ExternalCommunicatorChannel).singleton(),
            }

            const { [QueueConnectionType.Internal]: internalQueueConfig, [QueueConnectionType.External]: externalQueueConfig } =
                config.rabbit

            const externalQueueDeps = externalQueueConfig
                ? {
                      externalEventBus: asClass(ExternalEventBus, {
                          injector: (c) => ({ queueProvider: c.resolve<Queue>('queue').getExternalQueue() }),
                      }).singleton(),
                      external: asClass(ExternalCommunicator).singleton(),
                  }
                : {}

            const internalQueueDeps = internalQueueConfig
                ? {
                      task: asClass(Task, {
                          injector: (c) => ({ queueProvider: c.resolve<Queue>('queue').getInternalQueue() }),
                      }).singleton(),

                      ...(internalQueueConfig.scheduledTaskQueueName && {
                          scheduledTask: asClass(ScheduledTask, {
                              injector: (c) => ({
                                  queueProvider: c.resolve<Queue>('queue').getInternalQueue(),
                                  queueName: internalQueueConfig.scheduledTaskQueueName,
                              }),
                          }).singleton(),
                      }),

                      ...(internalQueueConfig.queueName && {
                          eventBus: asClass(EventBus, {
                              injector: (c) => ({
                                  queueProvider: c.resolve<Queue>('queue').getInternalQueue(),
                                  queueName: internalQueueConfig.queueName,
                              }),
                          }).singleton(),
                      }),
                  }
                : {}

            queueDeps = {
                ...baseQueueDeps,
                ...internalQueueDeps,
                ...externalQueueDeps,
            }
        }

        return {
            config: asValue(config),
            validator: asClass(AppValidator).singleton(),
            moleculer: isMoleculerEnabled ? asClass(MoleculerService).singleton() : asValue(undefined),
            actionFactory: asClass(ActionFactory, {
                injector: (c) => ({ redlock: c.hasRegistration('redlock') ? c.resolve('redlock') : null }),
            }).singleton(),
            metrics: asClass(MetricsService, {
                injector: () => ({ metricsConfig: config.metrics?.custom || {}, isMoleculerEnabled }),
            }).singleton(),
            grpcClientFactory: asClass(GrpcClientFactory).singleton(),
            ...redisDeps,
            ...queueDeps,
        }
    }

    private async start(): Promise<void> {
        await this.resolveDeps()
    }

    private async stop(): Promise<void> {
        const registeredInstances = Object.keys(this.container.registrations)
        const logger = this.container.resolve<Logger>('logger')
        const onDestroyInstances: OnDestroy[] = []
        const onBeforeAppShutdownInstances: OnBeforeApplicationShutdown[] = []

        registeredInstances.forEach((name) => {
            const instance = this.container.resolve(name)
            if (guards.hasOnDestroyHook(instance)) {
                onDestroyInstances.push(instance)
            }

            if (guards.hasOnBeforeApplicationShutdownHook(instance)) {
                onBeforeAppShutdownInstances.push(instance)
            }
        })
        const onDestroyTasks = onDestroyInstances.map(async (instance) => {
            await instance.onDestroy()
            logger.info(`[onDestroy] Finished ${instance.constructor.name} destruction`)
        })
        const onDestroyErrors = await this.runHookTasks(onDestroyTasks)

        const onBeforeAppShutdownTasks = onBeforeAppShutdownInstances.map(async (instance) => {
            await instance.onBeforeApplicationShutdown()
            logger.info(`[onBeforeAppShutdown] Finished ${instance.constructor.name} destruction`)
        })
        const onBeforeAppShutdownErrors = await this.runHookTasks(onBeforeAppShutdownTasks)
        if (onDestroyErrors.length || onBeforeAppShutdownErrors.length) {
            throw new AggregateError(onDestroyErrors.concat(onBeforeAppShutdownErrors))
        }
    }

    private async runHookTasks(tasks: Promise<void>[]): Promise<Error[]> {
        return (await Promise.allSettled(tasks)).filter(guards.isSettledError).map((err) => new Error(err.reason))
    }

    private loadDefaultDepsFolders(): void {
        this.loadDepsFromFolder({
            folderName: 'actions',
            groupName: 'actionList',
        })

        this.loadDepsFromFolder({
            folderName: 'tasks',
            groupName: 'taskList',
        })

        this.loadDepsFromFolder({
            folderName: 'scheduledTasks',
            groupName: 'scheduledTaskList',
        })

        this.loadDepsFromFolder({
            folderName: 'eventListeners',
            groupName: 'eventListenerList',
        })

        this.loadDepsFromFolder({
            folderName: 'externalEventListeners',
            groupName: 'externalEventListenerList',
        })

        this.loadDepsFromFolder({
            folderName: 'services',
        })

        this.loadDepsFromFolder({
            folderName: 'dataMappers',
            nameFormatter: (name): string => name,
        })
    }

    private resolvePluginDepsCollections(): void {
        Object.entries(this.groupedPluginDepsNames).map(([aggregateName, moduleNames]) => {
            const pluginDepsCollection = this.container.resolve(aggregateName)

            pluginDepsCollection.addItems(moduleNames.map((moduleName) => this.container.resolve(moduleName)))
        })
    }

    private async resolveDeps(): Promise<void> {
        this.resolvePluginDepsCollections()
        Object.entries(this.groupedDepsNames).map(([aggregateName, moduleNames]) => {
            const group = this.container.resolve(aggregateName)

            moduleNames.forEach((moduleName) => group.push(this.container.resolve(moduleName)))
        })

        const registeredObjects = Object.keys(this.container.registrations)
        const logger = this.container.resolve<Logger>('logger')
        const initOrder: [OnInit[], OnInit[], OnInit[], OnInit[]] = [[], [], [], []]
        const registrationsFinishedHooks: OnRegistrationsFinished[] = []

        registeredObjects.map((name) => {
            const instance = this.container.resolve(name)
            if (guards.hasOnInitHook(instance)) {
                const order = this.getOrder(instance)

                initOrder[order].push(instance)
            }

            if (guards.hasOnRegistrationsFinishedHook(instance)) {
                registrationsFinishedHooks.push(instance)
            }
        })

        await Promise.all(
            registrationsFinishedHooks.map(async (instance) => {
                await instance.onRegistrationsFinished()
                logger.info(`[onRegistrationsFinished] Finished ${instance.constructor.name}`)
            }),
        )

        for (const [order, instancesWithOnInitHook] of initOrder.entries()) {
            await Promise.all(
                instancesWithOnInitHook.map(async (instance) => {
                    await instance.onInit()

                    logger.info(`[onInit:${order}] Finished ${instance.constructor.name} initialization`)
                }),
            )
        }
    }

    private getOrder(instance: OnInit): 0 | 1 | 2 | 3 {
        if (instance.constructor.name === EnvService.name) {
            return 0
        }

        if (this.syncCommunicationClasses.some((item) => instance.constructor.name === item.name)) {
            return 2
        }

        if (this.asyncCommunicationClasses.some((item) => instance.constructor.name === item.name)) {
            return 3
        }

        return 1
    }

    private createContext(): ServiceContext<BaseConfig & ConfigType<TContext>, BaseDeps & DepsType<TContext>> {
        return {
            config: this.config!,
            deps: this.container && this.container.cradle,
            container: this.container,
        }
    }

    private setOnShutDownHook(): void {
        process.on('SIGINT', (err) => this.onShutDown('On SIGINT shutdown', err))
        process.on('SIGQUIT', (err) => this.onShutDown('On SIGQUIT shutdown', err))

        const UncaughtExceptionMetric = new Counter('uncaught_exceptions_total')

        process.on('uncaughtException', async (err) => {
            UncaughtExceptionMetric.increment({})
            await this.onShutDown('On uncaughtException shutdown', err)
        })

        const UnhandledRejectionMetric = new Counter('unhandled_rejections_total')

        process.on('unhandledRejection', async (err: Error) => {
            UnhandledRejectionMetric.increment({})
            await this.onShutDown('On unhandledRejection shutdown', err)
        })
    }

    private async onShutDown(msg: string, error: unknown): Promise<void> {
        if (error) {
            this.container.resolve<Logger>('logger').error(msg, { err: error })
        } else {
            this.container.resolve<Logger>('logger').warn(msg)
        }

        try {
            await this.stop()
        } catch (err) {
            this.container.resolve<Logger>('logger').error('Failed to stop service', { err })
        }

        // eslint-disable-next-line no-process-exit
        setImmediate(() => process.exit(1))
    }
}

export default Application
