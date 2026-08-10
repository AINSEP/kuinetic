import js from '@eslint/js'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'

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
      '@typescript-eslint/no-non-null-assertion': 'off',
      'sonarjs/no-nested-functions': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: { 'sonarjs/no-duplicate-string': 'off' },
  },
  { ignores: ['node_modules', 'dist'] },
)
