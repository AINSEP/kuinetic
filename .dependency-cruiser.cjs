/**
 * Architectural import rules.
 *
 * ESLint's per-file complexity gates can't see cross-file structure — an import cycle or a
 * layering violation is invisible to a linter looking at one file at a time. This is that check.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle makes module init order depend on which file happens to be imported first — ' +
        'exactly the class of bug that is invisible in review and only shows up at runtime.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-must-not-depend-on-effects',
      severity: 'error',
      comment:
        'src/core is the effect-agnostic runtime (parser, compiler, animator); effects depend on ' +
        'core, never the reverse. See docs/design.md §6.',
      from: { path: '^src/core' },
      to: { path: '^src/effects' },
    },
  ],
  options: {
    // `false` resolves the graph the way `tsc` actually emits it: `import type` (erased by
    // `verbatimModuleSyntax`) drops out entirely. Two mutual-type-reference "cycles" — pure
    // `import type` edges with no runtime existence — showed up as false positives under `true`.
    tsPreCompilationDeps: false,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'types'] },
    doNotFollow: { path: 'node_modules' },
  },
}
