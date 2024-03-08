/* eslint-disable @typescript-eslint/no-explicit-any */
import { AwilixContainer, BuildResolverOptions, Resolver } from 'awilix'
import { NameFormatter } from 'awilix/lib/load-modules'

import { EnvService } from '@diia-inhouse/env'
import { GenericObject } from '@diia-inhouse/types'

import { BaseConfig } from './config'
import { BaseDeps, ExternallyRegisteredDeps, InternallyRegisteredDeps } from './deps'

export type DepsResolver<T> = {
    [U in keyof T]: Resolver<T[U]>
}

export interface ServiceContext<TConfig extends GenericObject = any, TDeps extends GenericObject = any> {
    config: TConfig
    container: AwilixContainer<TDeps>
    deps: TDeps
}

export type ConfigType<TConfig> = TConfig extends ServiceContext<infer T, any> ? T : never

export type DepsType<TDeps> = TDeps extends ServiceContext<any, infer T> ? T : never

export type ConfigFactoryFn<TConfig extends GenericObject = GenericObject> = (
    envService: EnvService,
    serviceName: string,
) => Promise<TConfig>

export type DepsFactoryFn<TConfig extends BaseConfig = BaseConfig, TDeps extends GenericObject = GenericObject> = (
    config: TConfig,
) => DepsResolver<ExternallyRegisteredDeps & Partial<InternallyRegisteredDeps> & TDeps>

export interface ServiceOperator<TConfig extends GenericObject, TDeps extends GenericObject>
    extends ServiceContext<BaseConfig & TConfig, BaseDeps & TDeps> {
    start(): Promise<void>
    stop(): Promise<void>
}

export interface LoadDepsFromFolderOptions {
    folderName: string
    fileMask?: string
    nameFormatter?: NameFormatter
    resolverOptions?: BuildResolverOptions<unknown>
    groupName?: string
    pluginGroupName?: string
}
