import { configFactory } from '../config'

export type AppConfig = Awaited<ReturnType<typeof configFactory>>
