import { asClass } from 'awilix'

import { HashService } from '@diia-inhouse/crypto'

import { DepsFactoryFn } from '../../src'
import { AppConfig } from './interfaces/config'
import { AppDeps } from './interfaces/deps'

export default async (): ReturnType<DepsFactoryFn<AppConfig, AppDeps>> => {
    return {
        hash: asClass(HashService).singleton(),
    }
}
