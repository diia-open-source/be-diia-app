import tsConfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const timeout = 60 * 1000

export default defineConfig({
    plugins: [tsConfigPaths()],
    test: {
        env: {
            NODE_ENV: 'test',
        },
        clearMocks: true,
        restoreMocks: true,
        mockReset: true,
        globals: true,
        testTimeout: timeout,
        hookTimeout: timeout,
        exclude: ['node_modules', 'dist'],
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['tests/unit/**/*.spec.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'integration',
                    include: ['tests/integration/**/*.spec.ts'],
                    setupFiles: ['tests/integration/setup.ts'],
                },
            },
        ],
    },
})
