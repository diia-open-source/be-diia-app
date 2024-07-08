import { HashService } from '@diia-inhouse/crypto'

import { CallOptions } from '../../../src'
import { TestClient, TestPrivateClient } from '../generated/test-service'

export type AppDeps = {
    hash: HashService
    testServiceClient: TestClient<CallOptions>
    testPrivateServiceClient: TestPrivateClient<CallOptions>
}
