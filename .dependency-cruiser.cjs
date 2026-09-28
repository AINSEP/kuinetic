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
    {
      name: 'showcase-no-heavy-core',
      severity: 'error',
      comment:
        'src/showcase ships inside kuinetic.js today but is designed to split into its own ' +
        'script tag; a value import of the compiler/animator/registry pulls the whole runtime ' +
        'into that split bundle too. See src/3d/register.ts: dropping two such imports took the ' +
        'advanced tier from 45.6 to 17.4 KB gz.',
      from: { path: '^src/showcase' },
      to: { path: '^src/core/(registry|animator|compile|parse|js-effect-preparer)\\.ts$' },
    },
    {
      name: 'showcase-no-effects-barrel',
      severity: 'error',
      comment:
        'src/effects/index.ts already imports src/showcase (to register it); the reverse edge ' +
        'would be a cycle and would inline the whole effect catalog into a split showcase bundle.',
      from: { path: '^src/showcase' },
      to: { path: '^src/effects/index\\.ts$' },
    },
    {
      name: 'only-effects-barrel-imports-showcase',
      severity: 'error',
      comment:
        'Only src/effects/index.ts wires the showcase module in, so splitting it out later is one ' +
        'deleted line there rather than a search for every other file that reached into it.',
      from: { path: '^src/(core|effects/(?!index\\.ts))' },
      to: { path: '^src/showcase' },
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
