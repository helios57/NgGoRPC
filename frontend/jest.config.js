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
};
