import { configFactory } from '../../mocks'

export type AppConfig = Awaited<ReturnType<typeof configFactory>>
