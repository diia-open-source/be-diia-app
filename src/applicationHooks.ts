import { AwilixContainer } from 'awilix'
import type { Class } from 'type-fest'

import { MetricsService } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { OnBeforeApplicationShutdown, OnDestroy, OnRegistrationsFinished } from '@diia-inhouse/types'
import { guards } from '@diia-inhouse/utils'

import { GrpcService } from './grpc'
import {
    AppDepsTypeWithBase,
    DepsType,
    InitOrder,
    MaxInitOrder,
    OnInitInstance,
    OnStartHooksResult,
    ServiceContext,
} from './interfaces/application'
import { OnInitResults } from './interfaces/onInitResults'
import MoleculerService from './moleculer/moleculerWrapper'

export abstract class ApplicationHooks<TContext extends ServiceContext> {
    private syncCommunicationClasses = [MoleculerService, GrpcService]

    abstract container?: AwilixContainer<DepsType<TContext>>

    protected abstract asyncCommunicationClasses: Class<unknown>[]

    protected async runOnStartHooks(): Promise<OnStartHooksResult> {
        if (!this.container) {
            throw new Error('Container should be initialized before start hooks')
        }

        const logger = this.container.resolve('logger')

        const registeredObjects = Object.keys(this.container.registrations)
        const onRegistrationsFinishedHooks: OnRegistrationsFinished[] = []
        const onInitHooksInOrder: [
            OnInitInstance<TContext>[],
            OnInitInstance<TContext>[],
            OnInitInstance<TContext>[],
            OnInitInstance<TContext>[],
            OnInitInstance<TContext>[],
        ] = [[], [], [], [], []]
        for (const name of registeredObjects) {
            const instance = this.container.resolve(name)
            if (guards.hasOnRegistrationsFinishedHook(instance)) {
                onRegistrationsFinishedHooks.push(instance)
            }

            if (guards.hasOnInitHook(instance)) {
                const order = this.getOnInitOrder(instance)

                onInitHooksInOrder[order].push({ name: name as keyof AppDepsTypeWithBase<TContext>, instance })
            }
        }

        await Promise.all(
            onRegistrationsFinishedHooks.map(async (instance) => {
                await instance.onRegistrationsFinished()
                logger.info(`[onRegistrationsFinished] Finished ${instance.constructor.name}`)
            }),
        )
        const result: Partial<OnStartHooksResult> = {}
        for (const [order, instancesWithOnInitHook] of onInitHooksInOrder.entries()) {
            await Promise.all(
                instancesWithOnInitHook.map(async ({ name, instance }) => {
                    const onInitResult = await instance.onInit()
                    const guardParam = [name, onInitResult] as const
                    if (this.isGrpcServiceOnInitHook(guardParam)) {
                        const [grpcServiceName, grpcServiceOnInitResult] = guardParam

                        result[grpcServiceName] = grpcServiceOnInitResult
                    }

                    logger.info(`[onInit:${order}] Finished ${instance.constructor.name} initialization`)
                }),
            )
        }

        return result as OnStartHooksResult
    }

    protected async runOnStopHooks(): Promise<void | never> {
        if (!this.container) {
            throw new Error('Container should be initialized before stop hooks')
        }

        const logger = this.container.resolve('logger')

        const registeredInstances = Object.keys(this.container.registrations)
        const onDestroyHooksInOrder: OnDestroy[][] = []
        const onBeforeAppShutdownInstances: OnBeforeApplicationShutdown[] = []
        for (const name of registeredInstances) {
            const instance = this.container.resolve(name)
            if (guards.hasOnBeforeApplicationShutdownHook(instance)) {
                onBeforeAppShutdownInstances.push(instance)
            }

            if (guards.hasOnDestroyHook(instance)) {
                const order = this.getOnDestroyOrder(instance)

                onDestroyHooksInOrder[order] ??= []
                onDestroyHooksInOrder[order].push(instance)
            }
        }

        const onDestroyErrors: Error[] = []
        for (const [order, instancesWithOnDestroyHook = []] of onDestroyHooksInOrder.entries()) {
            const onDestroyTasks = instancesWithOnDestroyHook.map(async (instance) => {
                try {
                    await instance.onDestroy()
                    logger.info(`[onDestroy:${order}] Finished ${instance.constructor.name} destruction`)
                } catch (err) {
                    logger.error(`[onDestroy:${order}] Failed ${instance.constructor.name} destruction`, { err })
                    throw err
                }
            })
            const errors = await this.allSettledHookTasks(onDestroyTasks)

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

        const onBeforeAppShutdownErrors = await this.allSettledHookTasks(onBeforeAppShutdownTasks)
        if (onDestroyErrors.length > 0 || onBeforeAppShutdownErrors.length > 0) {
            throw new AggregateError(onDestroyErrors.concat(onBeforeAppShutdownErrors), 'Failed to stop service')
        }
    }

    private isGrpcServiceOnInitHook(
        param: readonly [keyof AppDepsTypeWithBase<TContext>, unknown],
    ): param is readonly ['grpcService', OnInitResults['grpcService']] {
        const [name] = param

        return name === 'grpcService'
    }

    private async allSettledHookTasks(tasks: Promise<void>[]): Promise<Error[]> {
        const results = await Promise.allSettled(tasks)

        return results.filter(guards.isSettledError).map((err) => new Error(err.reason))
    }

    private getOnInitOrder(instance: object): InitOrder {
        if (instance.constructor.name === EnvService.name) {
            return 0
        }

        if (instance.constructor.name === MetricsService.name) {
            return 1
        }

        if (this.syncCommunicationClasses.some((item) => instance.constructor.name === item.name)) {
            return 3
        }

        if (this.asyncCommunicationClasses.some((item) => instance.constructor.name === item.name)) {
            return 4
        }

        return 2
    }

    private getOnDestroyOrder(instance: OnDestroy): number {
        const onInitOrder = this.getOnInitOrder(instance)
        const maxInitOrder: MaxInitOrder = 4

        return Math.abs(onInitOrder - maxInitOrder)
    }
}
