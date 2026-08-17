import js from '@eslint/js'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'
import globals from 'globals'

/**
 * Complexity gate.
 *
 * Both metrics are capped at 10 and are errors, not warnings — the ceiling is enforced by CI
 * rather than asserted in review. A function that genuinely needs more must carry an inline
 * `eslint-disable-next-line` with a comment stating why; that makes every exception visible in
 * the diff and greppable in the repo.
 *
 * - `complexity` counts independent paths through a function (cyclomatic).
 * - `sonarjs/cognitive-complexity` penalises *nesting*, which is what actually makes code hard
 *   to read; a flat 12-case switch scores low, three nested loops score high.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      complexity: ['error', 10],
      'sonarjs/cognitive-complexity': ['error', 10],
      'max-depth': ['error', 3],
      'max-params': ['error', 4],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'sonarjs/no-nested-functions': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      'sonarjs/no-duplicate-string': 'off',
      // A thorough `it()`/`describe()` block reads better as one place with all its assertions
      // together than split apart to satisfy a line count; the 60-line cap is a production-code
      // readability signal that doesn't transfer to test bodies the same way.
      'max-lines-per-function': 'off',
    },
  },
  {
    // Plain Node scripts (build tooling, dev server, Playwright-driven verification) — not
    // library source, not bundled, not type-checked as part of the project. `projectService`
    // requires TS-project membership, which these `.mjs` files intentionally have none of (they
    // run under plain Node, not the bundler), so the base `typescript-eslint/base` config's parser
    // is repointed at plain (non-type-aware) parsing here instead of failing with "not found by
    // the project service". `tseslint.configs.recommended`'s rules are all syntactic — none need
    // type info — so they still apply in full; only the parser wiring changes.
    //
    // Globals are both Node's (the scripts themselves) and the browser's (`dev-server.mjs`'s
    // inlined livereload snippet, and every `page.evaluate`/`page.$eval` callback in the
    // Playwright-driven scripts — those callbacks are serialised and run inside the browser page,
    // not Node, even though they live in the same file).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { projectService: false, project: false },
    },
    rules: {
      // These scripts intentionally resolve `npm`/`npx` via PATH rather than an absolute path —
      // see browser-harness.mjs's `loadChromium` doc comment, which rejects hardcoding an
      // absolute path for the same class of command as unrunnable outside one machine. They're
      // internal build/verification tooling invoked with fixed, hardcoded arguments in a trusted
      // dev/CI environment, not processing untrusted input, so PATH-based resolution is the
      // correct tradeoff here rather than the injection risk this rule guards against elsewhere.
      'sonarjs/no-os-command-from-path': 'off',
    },
  },
  {
    // `test/browser/**/*.mjs` sits under `test/`, so `npm run lint`'s `test` argument would
    // otherwise pull it in as TS-project-checked source; it's plain-Node Playwright suites on the
    // same footing as `scripts/`, just not in scope for this pass. Keep it ignored rather than
    // silently mis-parsed.
    ignores: ['node_modules', 'dist', 'test/browser/**/*.mjs'],
  },
)
