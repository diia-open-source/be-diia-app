import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'

import { AwilixContainer, InjectionMode, NameAndRegistrationPair, asClass, asValue, createContainer, listModules } from 'awilix'
import { NameFormatter } from 'awilix/lib/load-modules'
import { camelCase, upperFirst } from 'lodash'
import { singular } from 'pluralize'
import type { Class } from 'type-fest'

import { Counter } from '@diia-inhouse/diia-metrics'
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

import { getBaseDeps } from './baseDeps'
import { GrpcService } from './grpc'
import {
    AppConfigType,
    AppDepsType,
    ConfigFactoryFn,
    DepsFactoryFn,
    DepsType,
    LoadDepsFromFolderOptions,
    ServiceContext,
    ServiceOperator,
} from './interfaces/application'
import { BaseDeps } from './interfaces/deps'
import MoleculerService from './moleculer/moleculerWrapper'

export class Application<TContext extends ServiceContext> {
    private config?: AppConfigType<TContext>

    private container?: AwilixContainer<DepsType<TContext>>

    private baseContainer: AwilixContainer<BaseDeps<AppConfigType<TContext>>>

    private groupedDepsNames: Record<string, string[]> = {}

    private syncCommunicationClasses = [MoleculerService, GrpcService]

    private asyncCommunicationClasses: Class<unknown>[] = []

    constructor(
        private readonly serviceName: string,
        loggerPkg = '@diia-inhouse/diia-logger',
    ) {
        this.baseContainer = createContainer<BaseDeps<AppConfigType<TContext>>>({ injectionMode: InjectionMode.CLASSIC }).register({
            serviceName: asValue(this.serviceName),
            envService: asClass(EnvService).singleton(),
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            logger: asClass(<LoggerConstructor>require(loggerPkg).default, {
                injector: () => ({ options: { logLevel: process.env.LOG_LEVEL } }),
            }).singleton(),
            asyncLocalStorage: asValue(new AsyncLocalStorage<AlsData>()),
        })
    }

    async setConfig(factory: ConfigFactoryFn<AppConfigType<TContext>>): Promise<this> {
        const envService = this.baseContainer.resolve('envService')

        await envService.init()
        this.config = await factory(envService, this.serviceName)

        return this
    }

    patchConfig(config: Partial<AppConfigType<TContext>>): void {
        if (!this.config) {
            throw new Error('Config should be set before patch')
        }

        Object.assign(this.config, config)
    }

    getConfig(): AppConfigType<TContext> {
        if (!this.config) {
            throw new Error('Config should be set before getting')
        }

        return this.config
    }

    async setDeps(factory: DepsFactoryFn<AppConfigType<TContext>, AppDepsType<TContext>>): Promise<this> {
        if (!this.config) {
            throw new Error('Config should be set before deps')
        }

        const baseDeps = await this.getBaseDeps()

        this.baseContainer.register(baseDeps)

        const appDeps = await factory(this.config, this.baseContainer)

        this.container = this.baseContainer
            .createScope<AppDepsType<TContext>>()
            .register(<NameAndRegistrationPair<DepsType<TContext>>>appDeps)

        return this
    }

    async initialize(): Promise<ServiceOperator<AppConfigType<TContext>, DepsType<TContext>>> {
        this.setOnShutDownHook()

        await this.loadDefaultDepsFolders()

        const ctx = this.createContext()

        return {
            ...ctx,
            start: this.start.bind(this),
            stop: this.stop.bind(this),
        }
    }

    defaultNameFormatter(folderName: string): NameFormatter {
        return (_, descriptor) => {
            const parsedPath = path.parse(descriptor.path)
            const fileName = parsedPath.name
            const dependencyPath = parsedPath.dir
                .split(`${this.getDepsDir()}${path.sep}${folderName}`)[1]
                .split(path.sep)
                .map((p) => upperFirst(p))

            if (fileName !== 'index') {
                dependencyPath.push(upperFirst(fileName))
            }

            const dependencyType = upperFirst(singular(folderName))

            return camelCase(`${dependencyPath.join('')}${dependencyType}`)
        }
    }

    async loadDepsFromFolder(options: LoadDepsFromFolderOptions): Promise<this> {
        const { folderName, fileMask = '**/*.js', nameFormatter = this.defaultNameFormatter(folderName), groupName } = options

        const directory = `${this.getDepsDir()}/${folderName}/${fileMask}`
        const modules = listModules(directory)

        if (groupName) {
            if (!Object.keys(this.baseContainer.registrations).includes(groupName)) {
                this.baseContainer.register(groupName, asValue([]))
            }

            this.groupedDepsNames[groupName] = this.groupedDepsNames[groupName] || []
        }

        for (const module of modules) {
            const { name, path: modulePath } = module
            const registrationName = nameFormatter(name, { ...module, value: '' })
            const dependency = await import(path.resolve(modulePath))
            const defaultExport = dependency.default?.default ?? dependency.default

            if (typeof defaultExport === 'function') {
                this.baseContainer.register(
                    registrationName,
                    asClass(defaultExport, {
                        injector: (c) => {
                            const logger = c.resolve<Logger>('logger')
                            const childLogger = logger.child?.({ regName: registrationName })

                            return { logger: childLogger ?? logger }
                        },
                    }).singleton(),
                )

                if (groupName) {
                    this.groupedDepsNames[groupName].push(registrationName)
                }
            }
        }

        return this
    }

    private getDepsDir(): string {
        return path.resolve(this.config?.depsDir ?? 'dist')
    }

    private async getBaseDeps(): Promise<NameAndRegistrationPair<BaseDeps<AppConfigType<TContext>>>> {
        const { config, asyncCommunicationClasses } = this
        if (!config) {
            throw new Error('Config should be set before using [getBaseDeps]')
        }

        if (config.rabbit) {
            const { ExternalCommunicator, ExternalEventBus, ScheduledTask, EventBus, Task } = await import('@diia-inhouse/diia-queue')

            asyncCommunicationClasses.push(ExternalCommunicator, ExternalEventBus, ScheduledTask, EventBus, Task)
        }

        return await getBaseDeps(config)
    }

    private async start(): Promise<void> {
        await this.resolveDeps()
    }

    private async stop(): Promise<void> {
        if (!this.container) {
            throw new Error('Container should be initialized before stopping')
        }

        const registeredInstances = Object.keys(this.container.registrations)
        const logger = this.container.resolve('logger')
        const destroyOrder: OnDestroy[][] = []
        const onBeforeAppShutdownInstances: OnBeforeApplicationShutdown[] = []
        for (const name of registeredInstances) {
            const instance = this.container.resolve(name)
            if (guards.hasOnDestroyHook(instance)) {
                const order = this.getOnDestroyOrder(instance)

                destroyOrder[order] ??= []
                destroyOrder[order].push(instance)
            }

            if (guards.hasOnBeforeApplicationShutdownHook(instance)) {
                onBeforeAppShutdownInstances.push(instance)
            }
        }

        const onDestroyErrors: Error[] = []
        for (const [order, instancesWithOnDestroyHook = []] of destroyOrder.entries()) {
            const onDestroyTasks = instancesWithOnDestroyHook.map(async (instance) => {
                try {
                    await instance.onDestroy()
                    logger.info(`[onDestroy:${order}] Finished ${instance.constructor.name} destruction`)
                } catch (err) {
                    logger.error(`[onDestroy:${order}] Failed ${instance.constructor.name} destruction`, { err })
                    throw err
                }
            })
            const errors = await this.runHookTasks(onDestroyTasks)

            onDestroyErrors.push(...errors)
        }

        const onBeforeAppShutdownTasks = onBeforeAppShutdownInstances.map(async (instance) => {
            try {
                await instance.onBeforeApplicationShutdown()
                logger.info(`[onBeforeAppShutdown] Finished ${instance.constructor.name} destruction`)
            } catch (err) {
                logger.error(`[onBeforeAppShutdown] Failed ${instance.constructor.name} destruction`, { err })
                throw err
            }
        })

        const onBeforeAppShutdownErrors = await this.runHookTasks(onBeforeAppShutdownTasks)
        if (onDestroyErrors.length > 0 || onBeforeAppShutdownErrors.length > 0) {
            throw new AggregateError(onDestroyErrors.concat(onBeforeAppShutdownErrors), 'Failed to stop service')
        }
    }

    private async runHookTasks(tasks: Promise<void>[]): Promise<Error[]> {
        const results = await Promise.allSettled(tasks)

        return results.filter(guards.isSettledError).map((err) => new Error(err.reason))
    }

    private async loadDefaultDepsFolders(): Promise<void> {
        await this.loadDepsFromFolder({
            folderName: 'actions',
            groupName: 'actionList',
        })

        await this.loadDepsFromFolder({
            folderName: 'tasks',
            groupName: 'taskList',
        })

        await this.loadDepsFromFolder({
            folderName: 'scheduledTasks',
            groupName: 'scheduledTaskList',
        })

        await this.loadDepsFromFolder({
            folderName: 'eventListeners',
            groupName: 'eventListenerList',
        })

        await this.loadDepsFromFolder({
            folderName: 'externalEventListeners',
            groupName: 'externalEventListenerList',
        })

        await this.loadDepsFromFolder({
            folderName: 'services',
        })

        await this.loadDepsFromFolder({
            folderName: 'dataMappers',
            nameFormatter: (name): string => name,
        })
    }

    private async resolveDeps(): Promise<void> {
        if (!this.container) {
            throw new Error('Container should be initialized before deps resolving')
        }

        for (const [aggregateName, moduleNames] of Object.entries(this.groupedDepsNames)) {
            const group = this.container.resolve<string[]>(aggregateName)

            for (const moduleName of moduleNames) {
                group.push(this.container.resolve(moduleName))
            }
        }

        const registeredObjects = Object.keys(this.container.registrations)
        const logger = this.container.resolve('logger')
        const initOrder: [OnInit[], OnInit[], OnInit[], OnInit[]] = [[], [], [], []]
        const registrationsFinishedHooks: OnRegistrationsFinished[] = []

        for (const name of registeredObjects) {
            const instance = this.container.resolve(name)
            if (guards.hasOnInitHook(instance)) {
                const order = this.getOnInitOrder(instance)

                initOrder[order].push(instance)
            }

            if (guards.hasOnRegistrationsFinishedHook(instance)) {
                registrationsFinishedHooks.push(instance)
            }
        }

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

    private getOnInitOrder(instance: object): 0 | 1 | 2 | 3 {
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

    private getOnDestroyOrder(instance: OnDestroy): number {
        const onInitOrder = this.getOnInitOrder(instance)

        return Math.abs(onInitOrder - 3)
    }

    private createContext(): ServiceContext<AppConfigType<TContext>, DepsType<TContext>> {
        if (!this.container || !this.config) {
            throw new Error('Container and config should be initialized before creating context')
        }

        return {
            config: this.config,
            container: this.container,
        }
    }

    private setOnShutDownHook(): void {
        const listenTerminationSignals = this.config?.listenTerminationSignals ?? true
        if (listenTerminationSignals) {
            process.on('SIGINT', (err) => this.onShutDown('On SIGINT shutdown', err))
            process.on('SIGQUIT', (err) => this.onShutDown('On SIGQUIT shutdown', err))
            process.on('SIGTERM', (err) => this.onShutDown('On SIGTERM shutdown', err))
        }

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
            this.baseContainer?.resolve('logger').error(msg, { err: error })
        } else {
            this.baseContainer?.resolve('logger').warn(msg)
        }

        try {
            await this.stop()
        } catch (err) {
            this.baseContainer?.resolve('logger').error('Failed to stop service. Shutdown completed', { err })
        }

        // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
        setImmediate(() => process.exit(error ? 1 : 0))
    }
}

export default Application
