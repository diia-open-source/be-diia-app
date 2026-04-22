import { asClass } from 'awilix'

import { HashService } from '@diia-inhouse/crypto'
import { FeatureService } from '@diia-inhouse/features'

import { DepsFactoryFn } from '../../src'
import { AppConfig } from './interfaces/config'
import { AppDeps } from './interfaces/deps'

export default async (config: AppConfig): ReturnType<DepsFactoryFn<AppConfig, AppDeps>> => {
    return {
        hash: asClass(HashService).singleton(),
        featureFlag: asClass(FeatureService, {
            injector: () => ({
                featureConfig: config.featureFlags,
            }),
        }).singleton(),
    }
}
