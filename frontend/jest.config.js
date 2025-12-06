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
    '^@angular/core/rxjs-interop$': '<rootDir>/projects/client/src/__mocks__/@angular/core/rxjs-interop.ts',
    '^@angular/core$': '<rootDir>/projects/client/src/__mocks__/@angular/core.ts',
  },
  collectCoverage: true,
  collectCoverageFrom: [
    'projects/client/src/lib/**/*.ts',
    '!projects/client/src/lib/**/*.spec.ts',
    '!projects/client/src/lib/**/*.d.ts',
  ],
  coverageDirectory: 'coverage/client',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
};
