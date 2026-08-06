// @ts-check
// ESLint flat config (ESLint 10 + angular-eslint 22). Replaces the previous
// per-project .eslintrc.json files, which the eslintrc format no longer supports.
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

module.exports = tseslint.config(
  // ── Build output is not source ────────────────────────────────────────────
  // Everything listed here is a generated artefact already ignored by
  // frontend/.gitignore. Without this block `npx eslint .` — the way anyone
  // lints outside the CLI — reported 5 errors and 3 warnings, ALL of them from
  // `coverage/client/`: karma-coverage's HTML report embeds the instrumented
  // source between `{`/`}` markers, so @angular-eslint/template-parser reads
  // each `*.ts.html` as an Angular template and dies on an "Invalid ICU
  // message"; its bundled `block-navigation.js` / `prettify.js` / `sorter.js`
  // each carry a blanket `/* eslint-disable */` that comes back as an "unused
  // disable directive". Every one of those 8 findings is about a file nobody
  // wrote and nobody can fix — a permanently-red lint that buries any real
  // finding and trains the eye to skip the whole check (CLAUDE.md §3).
  //
  // `ng lint` did NOT show this: angular.json scopes both lint targets with
  // `lintFilePatterns: projects/**`, so the CLI path never walked coverage/.
  // That divergence is the actual hazard — the config and the target disagreed
  // about what the repo lints. Now they agree.
  //
  // This narrows nothing real: `coverage/` only exists after `npm run
  // test:coverage`, and scoped to `projects/` the repo was already
  // 0 errors / 0 warnings (measured before and after this change).
  {
    ignores: [
      "dist/",
      "coverage/",
      "out-tsc/",
      "tmp/",
      "bazel-out/",
      ".angular/",
    ],
  },
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: "app", style: "camelCase" },
      ],
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: "app", style: "kebab-case" },
      ],
    },
  },
  // Library (nggorpc) — its own selector prefix and allow _-prefixed unused args.
  {
    files: ["projects/client/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: "nggorpc", style: "camelCase" },
      ],
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: "nggorpc", style: "kebab-case" },
      ],
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {},
  }
);
