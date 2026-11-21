import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Don-Game/',
  test: { include: ['tests/unit/**/*.test.js'] },
});
