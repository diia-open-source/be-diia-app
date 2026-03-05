import { AsyncLocalStorage } from 'node:async_hooks'
import { hostname } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import {
    AwilixContainer,
    Constructor,
    InjectionMode,
    ModuleDescriptor,
    NameAndRegistrationPair,
    asClass,
    asValue,
    createContainer,
    listModules,
} from 'awilix'
import { LoadedModuleDescriptor, NameFormatter } from 'awilix/lib/load-modules'
import { camelCase, upperFirst } from 'lodash'
import { singular } from 'pluralize'
import type { Class } from 'type-fest'

import { Counter, MetricOptions, Observer } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { AlsData, Logger, LoggerConstructor, LoggerOptions } from '@diia-inhouse/types'

import { ApplicationHooks } from './applicationHooks'
import { getBaseDeps } from './baseDeps'
import {
    AppConfigType,
    AppDepsType,
    ConfigFactoryFn,
    ContainerDependency,
    DepsFactoryFn,
    DepsType,
    LoadDepsFromFolderOptions,
    OnStartHooksResult,
    ServiceContext,
    ServiceOperator,
} from './interfaces/application'
import { BaseDeps } from './interfaces/deps'
import { NodeEnvLabelsMap, nodeEnvAllowedFields } from './metrics'

export class Application<TContext extends ServiceContext> extends ApplicationHooks<TContext> {
    container?: AwilixContainer<DepsType<TContext>>

    protected asyncCommunicationClasses: Class<unknown>[] = []

    private config?: AppConfigType<TContext>

    private baseContainer: AwilixContainer<BaseDeps<AppConfigType<TContext>>>

    private groupedDepsNames: Record<string, string[]> = {}

    private defaultFoldersWithDeps: Record<string, LoadDepsFromFolderOptions> = {
        actions: { folderName: 'actions', groupName: 'actionList' },
        tasks: { folderName: 'tasks', groupName: 'taskList' },
        scheduledTasks: { folderName: 'scheduledTasks', groupName: 'scheduledTaskList' },
        eventListeners: { folderName: 'eventListeners', groupName: 'eventListenerList' },
        externalEventListeners: { folderName: 'externalEventListeners', groupName: 'externalEventListenerList' },
        services: { folderName: 'services' },
        dataMappers: { folderName: 'dataMappers', nameFormatter: (name) => name },
        repositories: { folderName: 'repositories', nameFormatter: (name) => `${name}Repository` },
        views: { folderName: 'views' },
    }

    private readonly nodeEnvObserver: Observer<NodeEnvLabelsMap>

    private readonly eventLoopUtilizationObserver: Observer<{}>

    private previousEventLoopUtilization: ReturnType<typeof performance.eventLoopUtilization> | undefined

    constructor(
        private readonly serviceName: string,
        private readonly nodeTracerProvider: NodeTracerProvider,
        loggerOptions: LoggerOptions,
        loggerPkg = '@diia-inhouse/diia-logger',
    ) {
        super()
        this.baseContainer = createContainer<BaseDeps<AppConfigType<TContext>>>({ injectionMode: InjectionMode.CLASSIC }).register({
            serviceName: asValue(this.serviceName),
            systemServiceName: asValue(EnvService.getVar('APP_NAME', 'string', null) || this.serviceName),
            hostName: asValue(EnvService.getVar('POD_NAME', 'string', null) || hostname()),
            envService: asClass(EnvService).singleton(),

            // prettier-ignore
            // eslint-disable-next-line security/detect-non-literal-require
            logger: asClass(require(loggerPkg).default as LoggerConstructor, { // nosemgrep: eslint.detect-non-literal-require
                injector: () => ({ options: loggerOptions }),
            }).singleton(),
            asyncLocalStorage: asValue(new AsyncLocalStorage<AlsData>()),
        })
        this.nodeEnvObserver = new Observer<NodeEnvLabelsMap>(
            'diia_node_env',
            nodeEnvAllowedFields,
            'Indicates the NODE_ENV environment value',
            {
                onCollect: (): ReturnType<Required<MetricOptions<NodeEnvLabelsMap>>['onCollect']> => ({
                    labels: { env: this.baseContainer.resolve('envService').getEnv() },
                    value: 1,
                }),
            },
        )
        this.eventLoopUtilizationObserver = new Observer<{}>(
            'diia_node_event_loop_utilization_ratio',
            undefined,
            'Indicates the event loop utilization ratio',
            {
                onCollect: (): ReturnType<Required<MetricOptions<{}>>['onCollect']> => {
                    const currentUtilization = performance.eventLoopUtilization()

                    if (this.previousEventLoopUtilization === undefined) {
                        this.previousEventLoopUtilization = currentUtilization

                        return { labels: {}, value: 0 }
                    }

                    const deltaUtilization = performance.eventLoopUtilization(this.previousEventLoopUtilization)

                    this.previousEventLoopUtilization = currentUtilization

                    return { labels: {}, value: deltaUtilization.utilization }
                },
            },
        )
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
            .register(appDeps as NameAndRegistrationPair<DepsType<TContext>>)

        return this
    }

    async initialize(dependencies?: ContainerDependency[]): Promise<ServiceOperator<AppConfigType<TContext>, DepsType<TContext>>> {
        this.setOnShutDownHook()

        if (dependencies?.length) {
            this.registerDependencies(dependencies)
        } else {
            await this.loadDefaultDepsFolders()
        }

        const ctx = this.createContext()

        return {
            ...ctx,
            start: this.start.bind(this),
            stop: this.stop.bind(this),
        }
    }

    defaultNameFormatter(folderName: string, depsDir?: string): NameFormatter {
        return (_, descriptor) => {
            const parsedPath = path.parse(descriptor.path)
            const fileName = parsedPath.name
            const dependencyPath = parsedPath.dir
                .split(`${depsDir ?? this.getDepsDir()}${path.sep}${folderName}`)[1]
                .split(path.sep)
                .map((p) => upperFirst(p))

            if (fileName !== 'index') {
                dependencyPath.push(upperFirst(fileName))
            }

            const dependencyType = upperFirst(singular(folderName))

            return camelCase(`${dependencyPath.join('')}${dependencyType}`)
        }
    }

    extractDepsFromFolder(options: LoadDepsFromFolderOptions): ModuleDescriptor[] {
        const { folderName, depsDir } = options
        let fileMask = options.fileMask ?? '**/*.js'

        if (folderName === 'repositories') {
            const adapter = this.container?.resolve('databaseAdapter')

            fileMask = `{*.js,${adapter}/**/*.js}`
        }

        const directory = `${depsDir ?? this.getDepsDir()}/${folderName}/${fileMask}`
        const modules = listModules(directory)

        return modules
    }

    async extractDependenciesFromModules(
        modules: Record<string, Record<string, () => Promise<unknown>>>,
        depsDir: string,
    ): Promise<ContainerDependency[]> {
        modules = this.filterRepositoryModulesByAdapter(modules)

        const unwrappedModules: { folderName: string; filePath: string; file: () => Promise<unknown> }[] = []
        for (const [folderName, files] of Object.entries(modules)) {
            for (const [filePath, file] of Object.entries(files)) {
                unwrappedModules.push({ folderName, filePath, file })
            }
        }

        const dependencies: ContainerDependency[] = []
        for (const dep of unwrappedModules) {
            const { folderName, filePath, file } = dep
            const options = this.defaultFoldersWithDeps[folderName] ?? { folderName }

            const { groupName, nameFormatter = this.defaultNameFormatter(folderName, depsDir) } = options
            const { name } = path.parse(filePath)
            const registrationName = nameFormatter(name, { path: filePath } as LoadedModuleDescriptor)

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const module: any = await file()

            const defaultExport = module.default?.default ?? module.default

            dependencies.push({ groupName: groupName, registrationName, dependency: defaultExport })
        }

        return dependencies
    }

    async loadDepsFromFolder(options: LoadDepsFromFolderOptions): Promise<this> {
        const { folderName, depsDir, nameFormatter = this.defaultNameFormatter(folderName, depsDir), groupName } = options
        const modules = this.extractDepsFromFolder(options)

        if (groupName) {
            this.registerGroup(groupName)
        }

        const dependencies: ContainerDependency[] = []
        for (const module of modules) {
            const { name, path: modulePath } = module
            const registrationName = nameFormatter(name, { ...module, value: '' })
            const dependency = await import(path.resolve(modulePath))
            const defaultExport = dependency.default?.default ?? dependency.default

            if (typeof defaultExport === 'function') {
                dependencies.push({ groupName, registrationName, dependency: defaultExport })
            }
        }

        this.registerDependencies(dependencies)

        return this
    }

    private registerDependency(dependency: Constructor<object>, registrationName: string, groupName: string | undefined): void {
        this.baseContainer.register(
            registrationName,
            asClass(dependency, {
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

    private registerGroup(groupName: string): void {
        if (!Object.keys(this.baseContainer.registrations).includes(groupName)) {
            this.baseContainer.register(groupName, asValue([]))
        }

        this.groupedDepsNames[groupName] = this.groupedDepsNames[groupName] || []
    }

    private getDepsDir(): string {
        return path.resolve(this.config?.depsDir ?? 'dist')
    }

    private registerDependencies(dependencies: ContainerDependency[]): void {
        for (const dependency of dependencies) {
            const { dependency: defaultExport, groupName, registrationName } = dependency

            if (groupName) {
                this.registerGroup(groupName)
            }

            if (typeof defaultExport === 'function') {
                this.registerDependency(defaultExport, registrationName, groupName)
            }
        }

        const groupsToRegister = Object.values(this.defaultFoldersWithDeps).filter(({ groupName }) => groupName)
        for (const { groupName } of groupsToRegister) {
            this.registerGroup(groupName!)
        }
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

    private async start(): Promise<OnStartHooksResult> {
        if (!this.container) {
            throw new Error('Container should be initialized before start')
        }

        for (const [aggregateName, moduleNames] of Object.entries(this.groupedDepsNames)) {
            const group = this.container.resolve<string[]>(aggregateName)

            for (const moduleName of moduleNames) {
                group.push(this.container.resolve(moduleName))
            }
        }

        return await this.runOnStartHooks()
    }

    private async stop(): Promise<void> {
        try {
            await this.runOnStopHooks()
        } finally {
            try {
                await this.nodeTracerProvider.forceFlush()
            } catch (err) {
                this.baseContainer?.resolve('logger').error('Failed to flush tracer', { err })
            }
        }
    }

    private async loadDefaultDepsFolders(): Promise<void> {
        for (const config of Object.values(this.defaultFoldersWithDeps)) {
            await this.loadDepsFromFolder(config)
        }
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

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    private filterRepositoryModulesByAdapter(modules: Record<string, Record<string, () => Promise<unknown>>>) {
        if (!modules.repositories) {
            return modules
        }

        const databaseAdapter = this.container?.resolve('databaseAdapter')
        const filteredRepositories = Object.entries(modules.repositories).filter(([filePath]) => {
            const isInRepositoriesFolder = filePath.includes('/repositories/')
            const isInSubfolder = filePath.match(/\/repositories\/[^/]+\//)
            const isInDatabaseAdapterFolder = filePath.includes(`/repositories/${databaseAdapter}/`)

            return isInRepositoriesFolder && (!isInSubfolder || isInDatabaseAdapterFolder)
        })

        modules.repositories = Object.fromEntries(filteredRepositories)

        return modules
    }

    private setOnShutDownHook(): void {
        const listenTerminationSignals = this.config?.listenTerminationSignals ?? true
        if (listenTerminationSignals) {
            process.on('SIGINT', (signal) => this.onShutDown(`On ${signal} shutdown`))
            process.on('SIGQUIT', (signal) => this.onShutDown(`On ${signal} shutdown`))
            process.on('SIGTERM', (signal) => this.onShutDown(`On ${signal} shutdown`))
        }

        const UncaughtExceptionMetric = new Counter('uncaught_exceptions_total', [], 'Indicates the number of uncaught exceptions', {
            registry: this.baseContainer.resolve('metrics').pushGatewayRegistry,
        })

        process.on('uncaughtException', async (err) => {
            UncaughtExceptionMetric.increment({})
            this.baseContainer?.resolve('logger').error('On uncaughtException', { err })
        })

        const UnhandledRejectionMetric = new Counter('unhandled_rejections_total', [], 'Indicates the number of unhandled rejections', {
            registry: this.baseContainer.resolve('metrics').pushGatewayRegistry,
        })

        process.on('unhandledRejection', async (err: Error) => {
            UnhandledRejectionMetric.increment({})
            this.baseContainer?.resolve('logger').error('On unhandledRejection', { err })
        })
    }

    private async onShutDown(msg: string, error?: unknown): Promise<void> {
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

        // eslint-disable-next-line unicorn/no-process-exit
        setImmediate(() => process.exit(error ? 1 : 0))
    }
}

export default Application
