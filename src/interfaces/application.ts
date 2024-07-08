import { AwilixContainer, NameAndRegistrationPair } from 'awilix'
import { NameFormatter } from 'awilix/lib/load-modules'

import { EnvService } from '@diia-inhouse/env'
import { GenericObject } from '@diia-inhouse/types'

import { BaseConfig } from './config'
import { BaseDeps } from './deps'

export interface ServiceContext<TConfig extends BaseConfig = BaseConfig, TDeps extends object = object> {
    config: TConfig
    container: AwilixContainer<TDeps & BaseDeps>
}

export type AppConfigType<TContext> = TContext extends ServiceContext<infer T> ? T : never

export type AppDepsType<TContext> = TContext extends ServiceContext<GenericObject, infer T> ? T : never

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

export interface ServiceOperator<TConfig extends GenericObject, TDeps extends GenericObject>
    extends ServiceContext<BaseConfig & TConfig, BaseDeps & TDeps> {
    start(): Promise<void>
    stop(): Promise<void>
}

export interface LoadDepsFromFolderOptions {
    folderName: string
    fileMask?: string
    nameFormatter?: NameFormatter
    groupName?: string
}
