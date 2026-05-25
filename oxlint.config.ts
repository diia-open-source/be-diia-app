import { defineConfig, base } from '@diia-inhouse/oxc-config/oxlint'

export default defineConfig({
    ...base,
    ignorePatterns: [...base.ignorePatterns, 'tests/integration/generated/**', 'vitest.config.mts'],
    overrides: [
        ...(base.overrides ?? []),
        {
            files: ['src/**'],
            rules: {
                'eslint/no-restricted-imports': 'off',
            },
        },
    ],
})
