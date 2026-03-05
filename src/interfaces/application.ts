import { AwilixContainer, Constructor, NameAndRegistrationPair } from 'awilix'
import { NameFormatter } from 'awilix/lib/load-modules'

import { EnvService } from '@diia-inhouse/env'
import { GenericObject, OnInit } from '@diia-inhouse/types'

import { BaseConfig } from './config'
import { BaseDeps } from './deps'
import { OnInitResults } from './onInitResults'

export interface ServiceContext<TConfig extends BaseConfig = BaseConfig, TDeps extends object = object> {
    config: TConfig
    container: AwilixContainer<TDeps & BaseDeps>
}

export type AppConfigType<TContext> = TContext extends ServiceContext<infer T> ? T : never

export type AppDepsType<TContext> = TContext extends ServiceContext<GenericObject, infer T> ? T : never

export type AppDepsTypeWithBase<TContext> = TContext extends ServiceContext<GenericObject, infer T> ? T & BaseDeps : never

export type DepsType<TContext> = AppDepsType<TContext> & BaseDeps<AppConfigType<TContext>>

export type ConfigFactoryFn<TConfig extends GenericObject = GenericObject> = (
    envService: EnvService,
    serviceName: string,
) => Promise<TConfig>

export type DepsFactory<TDeps> = Partial<BaseDeps> & Omit<TDeps, 'config'>

export type DepsFactoryFn<TConfig extends BaseConfig = BaseConfig, TDeps extends GenericObject = GenericObject> = (
    config: TConfig,
    baseDeps: AwilixContainer<BaseDeps<TConfig>>,
) => Promise<NameAndRegistrationPair<DepsFactory<TDeps>>>

export interface ServiceOperator<TConfig extends GenericObject, TDeps extends GenericObject> extends ServiceContext<
    BaseConfig & TConfig,
    BaseDeps & TDeps
> {
    start(): Promise<OnStartHooksResult>
    stop(): Promise<void>
}

export interface LoadDepsFromFolderOptions {
    folderName: string
    fileMask?: string
    nameFormatter?: NameFormatter
    groupName?: string
    depsDir?: string
}

export interface ContainerDependency {
    registrationName: string
    dependency: Constructor<object>
    groupName?: string
}

export interface OnInitInstance<TContext extends ServiceContext> {
    name: keyof AppDepsTypeWithBase<TContext>
    instance: OnInit
}

export type OnStartHooksResult = {
    [K in keyof BaseDeps]: K extends keyof OnInitResults ? OnInitResults[K] : never
}

export type InitOrder = 0 | 1 | 2 | 3 | 4

type Max<N extends number, T extends 1[] = []> = {
    b: T['length']
    r: Max<N, [1, ...T]>
}[[N] extends [Partial<T>['length']] ? 'b' : 'r']

export type MaxInitOrder = Max<InitOrder>
