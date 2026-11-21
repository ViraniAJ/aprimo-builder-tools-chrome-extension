import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tools-src/**/test/**/*.test.ts'], environment: 'node' } });
