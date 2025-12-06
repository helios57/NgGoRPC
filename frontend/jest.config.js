const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
  testMatch: ['**/projects/client/src/**/*.spec.ts'],
  moduleNameMapper: {
    '^@angular/core$': '<rootDir>/projects/client/src/__mocks__/@angular/core.ts',
  },
  collectCoverage: true,
  collectCoverageFrom: [
    'projects/client/src/lib/**/*.ts',
    '!projects/client/src/lib/**/*.spec.ts',
    '!projects/client/src/lib/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
