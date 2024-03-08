export interface AppApiService {
    port: number
    ip: string
    routes: unknown[]
    methods: Record<string, unknown>
}
