import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.spec.ts', 'mock-host/**/*.spec.mjs'],
        environment: 'node',
    },
});
