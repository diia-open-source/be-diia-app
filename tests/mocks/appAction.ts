import { ActionVersion, SessionType } from '@diia-inhouse/types'

import { AppAction } from '../../src'

export const appAction: AppAction = {
    name: 'userActionName',
    sessionType: SessionType.User,
    handler() {},
    actionVersion: ActionVersion.V1,
    validationRules: {},
}
