import { RegisteredMethod } from './types'

export class SchemaRegistry {
    private readonly methods = new Map<string, RegisteredMethod>()

    register(method: RegisteredMethod): void {
        this.methods.set(method.grpcMethod, method)
    }

    setActionInfo(grpcMethod: string, actionName: string, sessionType: string): void {
        const method = this.methods.get(grpcMethod)
        if (method) {
            method.actionName = actionName
            method.sessionType = sessionType
        }
    }

    getAll(): RegisteredMethod[] {
        return Array.from(this.methods.values())
    }
}
