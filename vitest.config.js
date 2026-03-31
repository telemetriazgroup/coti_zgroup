const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
