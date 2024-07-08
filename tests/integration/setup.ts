jest.setTimeout(3000000)

const appDir = 'tests/integration'

if (!process.cwd().endsWith(appDir)) {
    process.chdir(appDir)
}
