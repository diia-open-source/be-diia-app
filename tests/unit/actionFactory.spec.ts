import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'

import { ObjectId } from 'bson'
import { Context } from 'moleculer'

import Logger from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import { EnvService } from '@diia-inhouse/env'
import { Lock, RedlockService } from '@diia-inhouse/redis'
import TestKit, { mockInstance } from '@diia-inhouse/test'
import { ActionSession, ActionVersion, AlsData, AppUser, SessionType } from '@diia-inhouse/types'
import { AppValidator } from '@diia-inhouse/validators'

import { ActionFactory, AppAction } from '../../src'

describe(`${ActionFactory.name}`, () => {
    const testKit = new TestKit()
    const envService = mockInstance(EnvService)
    const asyncLocalStorage = mockInstance(AsyncLocalStorage<AlsData>)
    const logger = mockInstance(Logger)
    const redlock = mockInstance(RedlockService)
    const validator = mockInstance(AppValidator)
    const metrics = mockInstance(MetricsService, {
        totalRequestMetric: {
            increment: jest.fn(),
        },
        totalTimerMetric: {
            observeSeconds: jest.fn(),
        },
        responseTotalTimerMetric: {
            observeSeconds: jest.fn(),
        },
    })
    const serviceName = 'File'

    const actionFactory = new ActionFactory(
        envService,
        <AsyncLocalStorage<AlsData>>asyncLocalStorage,
        logger,
        validator,
        serviceName,
        metrics,
        redlock,
    )

    describe(`method ${actionFactory.createActions.name}`, () => {
        it.each([
            [
                `${SessionType.User} session type`,
                'userActionName.v1',
                <AppAction>{
                    name: 'userActionName',
                    sessionType: SessionType.User,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `user-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'userActionName',
                    },
                    session: testKit.session.getUserSession(),
                    params: {
                        sessionType: SessionType.User,
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                `${SessionType.PortalUser} session type`,
                'portalUserActionName.v1',
                <AppAction>{
                    name: 'portalUserActionName',
                    sessionType: SessionType.PortalUser,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `portal-user-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'portalUserActionName',
                    },
                    session: testKit.session.getPortalUserSession(),
                    params: {
                        sessionType: SessionType.PortalUser,
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                `${SessionType.CabinetUser} session type`,
                'cabinetUserActionName.v1',
                <AppAction>{
                    name: 'cabinetUserActionName',
                    sessionType: SessionType.CabinetUser,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `cabinet-user-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'cabinetUserActionName',
                    },
                    session: testKit.session.getCabinetUserSession(),
                    params: {
                        sessionType: SessionType.CabinetUser,
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                `${SessionType.EResidentApplicant} session type`,
                'eResidentApplicantActionName.v1',
                <AppAction>{
                    name: 'eResidentApplicantActionName',
                    sessionType: SessionType.EResidentApplicant,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `e-resident-applicant-user-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'eResidentApplicantActionName',
                    },
                    session: testKit.session.getEResidentApplicantSession(),
                    params: {
                        sessionType: SessionType.EResidentApplicant,
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                `${SessionType.EResident} session type`,
                'eResidentActionName.v1',
                <AppAction>{
                    name: 'eResidentActionName',
                    sessionType: SessionType.EResident,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `e-resident-user-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'eResidentActionName',
                    },
                    session: testKit.session.getEResidentSession(),
                    params: {
                        sessionType: SessionType.EResident,
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                `${SessionType.ServiceUser} session type`,
                'serviceUserActionName.v1',
                <AppAction>{
                    name: 'serviceUserActionName',
                    sessionType: SessionType.ServiceUser,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `service-user-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'serviceUserActionName',
                    },
                    session: <ActionSession>{ sessionType: SessionType.ServiceUser, serviceUser: { login: randomUUID() } },
                    params: {
                        sessionType: SessionType.ServiceUser,
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                `${SessionType.Partner} session type`,
                'partnerActionName.v1',
                <AppAction>{
                    name: 'partnerActionName',
                    sessionType: SessionType.Partner,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `partner-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'partnerActionName',
                    },
                    session: testKit.session.getPartnerSession(),
                    params: {
                        sessionType: SessionType.Partner,
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                `${SessionType.Acquirer} session type`,
                'acquirerActionName.v1',
                <AppAction>{
                    name: 'acquirerActionName',
                    sessionType: SessionType.Acquirer,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `acquirer-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'acquirerActionName',
                    },
                    session: <ActionSession>{ sessionType: SessionType.Acquirer, acquirer: { _id: new ObjectId() } },
                    params: {
                        sessionType: SessionType.Acquirer,
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                `${SessionType.Temporary} session type`,
                'temporaryActionName.v1',
                <AppAction>{
                    name: 'temporaryActionName',
                    sessionType: SessionType.Temporary,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `temporary-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'temporaryActionName',
                    },
                    session: <ActionSession>{ sessionType: SessionType.Temporary, temporary: { mobileUid: randomUUID() } },
                    params: {
                        sessionType: SessionType.Temporary,
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                `${SessionType.ServiceEntrance} session type`,
                'serviceEntranceActionName.v1',
                <AppAction>{
                    name: 'serviceEntranceActionName',
                    sessionType: SessionType.ServiceEntrance,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `service-entrance-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'serviceEntranceActionName',
                    },
                    session: testKit.session.getServiceEntranceSession(),
                    params: {
                        sessionType: SessionType.ServiceEntrance,
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                'no action name in context',
                'someActionName.v1',
                <AppAction>{
                    name: 'someActionName',
                    sessionType: SessionType.User,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `user-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {},
                    session: testKit.session.getUserSession(),
                    params: {
                        sessionType: SessionType.User,
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                'need to merge session which is present in params',
                'userActionName.v1',
                <AppAction>{
                    name: 'userActionName',
                    sessionType: SessionType.User,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                    getLockResource(args) {
                        const {
                            headers: { mobileUid },
                        } = args

                        return `user-${mobileUid}`
                    },
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'userActionName',
                    },
                    session: <ActionSession>{},
                    params: {
                        sessionType: SessionType.User,
                        user: <AppUser>{},
                        session: testKit.session.getUserSession(),
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
            [
                'session type is none',
                'noneActionName.v1',
                <AppAction>{
                    name: 'noneActionName',
                    sessionType: SessionType.None,
                    handler() {},
                    actionVersion: ActionVersion.V1,
                    validationRules: {},
                },
                <Context<ActionSession>>(<unknown>{
                    action: {
                        name: 'noneActionName',
                    },
                    params: {
                        user: <AppUser>{},
                        headers: { mobileUid: randomUUID() },
                    },
                }),
            ],
        ])(
            'should create action and run handler when %s',
            async (_msg, actionNameWithVersion: string, validAction: AppAction, ctx: Context<ActionSession>) => {
                jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_alsData, run) => {
                    await run()
                })

                const actions = <Record<string, { handler: CallableFunction }>>actionFactory.createActions([validAction])

                expect(actions[actionNameWithVersion]).toHaveProperty('handler')

                await actions[actionNameWithVersion].handler(ctx)
            },
        )

        it('should fail to create actions in case action has get lock resource but redlock is not specified', async () => {
            const actionFactoryWithoutLock = new ActionFactory(
                envService,
                <AsyncLocalStorage<AlsData>>asyncLocalStorage,
                logger,
                validator,
                serviceName,
                metrics,
            )
            const expectedError = new Error('Lock resource cannot be used without a redlock service')

            const validAction = <AppAction>{
                name: 'userActionName',
                sessionType: SessionType.User,
                handler() {},
                actionVersion: ActionVersion.V1,
                validationRules: {},
                getLockResource(args) {
                    const {
                        headers: { mobileUid },
                    } = args

                    return `user-${mobileUid}`
                },
            }

            expect(() => {
                actionFactoryWithoutLock.createActions([validAction])
            }).toThrow(expectedError)
            expect(logger.error).toHaveBeenCalledWith('Failed to init actions', { err: expectedError })
        })

        it('should reject with error in case action was added successfully but handler rejects with error', async () => {
            const expectedError = new Error('Unable to execute action')
            const actionNameWithVersion = 'userActionName.v1'
            const validAction: AppAction = {
                name: 'userActionName',
                sessionType: SessionType.User,
                async handler() {
                    throw expectedError
                },
                actionVersion: ActionVersion.V1,
                validationRules: {},
            }
            const ctx = <Context<ActionSession>>(<unknown>{
                action: {
                    name: 'userActionName',
                },
                session: testKit.session.getUserSession(),
                params: {
                    sessionType: SessionType.User,
                    user: <AppUser>{},
                    headers: {
                        mobileUid: randomUUID(),
                    },
                },
            })

            jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_alsData, run) => {
                await run()
            })

            const actions = <Record<string, { handler: CallableFunction }>>actionFactory.createActions([validAction])

            expect(actions[actionNameWithVersion]).toHaveProperty('handler')

            await expect(async () => {
                await actions[actionNameWithVersion].handler(ctx)
            }).rejects.toEqual(expectedError)
        })

        it('should reject with error in case session type is unknown when building log data', async () => {
            const expectedError = new Error('Unexpected sessionType: unknown')
            const actionNameWithVersion = 'userActionName.v1'
            const validAction: AppAction = {
                name: 'userActionName',
                sessionType: <SessionType>'unknown',
                async handler() {
                    throw expectedError
                },
                actionVersion: ActionVersion.V1,
                validationRules: {},
                getLockResource(args) {
                    const {
                        headers: { mobileUid },
                    } = args

                    return `user-${mobileUid}`
                },
            }
            const ctx = <Context<ActionSession>>(<unknown>{
                action: {
                    name: 'userActionName',
                },
                session: <ActionSession>{
                    sessionType: <SessionType>'unknown',
                    user: { identifier: testKit.session.getUserSession().user.identifier },
                },
                params: {
                    sessionType: <SessionType>'unknown',
                    user: <AppUser>{},
                    headers: {
                        mobileUid: randomUUID(),
                    },
                },
            })

            jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_alsData, run) => {
                await run()
            })
            jest.spyOn(redlock, 'lock').mockResolvedValue(<Lock>{})

            const actions = <Record<string, { handler: CallableFunction }>>actionFactory.createActions([validAction])

            expect(actions[actionNameWithVersion]).toHaveProperty('handler')

            await expect(async () => {
                await actions[actionNameWithVersion].handler(ctx)
            }).rejects.toEqual(expectedError)
        })
    })
})
