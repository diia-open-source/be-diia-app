import * as dotenv from 'dotenv-flow'

dotenv.config({ path: 'tests/integration/.env.test', silent: true })

const appDir = 'tests/integration'

if (!process.cwd().endsWith(appDir)) {
    process.chdir(appDir)
}
