import { KeysOfUnion } from '@diia-inhouse/diia-metrics'
import { Env } from '@diia-inhouse/env'

export class NodeEnvLabelsMapConcrete {
    env: string = Env.Local
}

export type NodeEnvLabelsMap = NodeEnvLabelsMapConcrete

export const nodeEnvAllowedFields = Object.keys(new NodeEnvLabelsMapConcrete()) as KeysOfUnion<NodeEnvLabelsMap>[]
