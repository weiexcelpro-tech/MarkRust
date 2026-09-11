import { defineConfig } from 'vitest/config';

// Minimal test-only config: the package's vite.config.ts pulls in the lib
// build plugin (@laynezh/vite-plugin-lib-assets), which is not installed in
// this workspace. Unit specs only need TS transform + happy-dom.
export default defineConfig({
    test: {
        environment: 'happy-dom',
        include: ['src/**/__tests__/**/*.spec.ts'],
        setupFiles: ['vitest.setup.ts'],
    },
});
