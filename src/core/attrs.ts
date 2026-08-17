/** Attribute names, in one place so the namespace is a single rename before publish. */
export const ATTR = {
  /** Authored. The rich grammar. */
  source: 'data-kui',
  /** Library-owned and unstable: normalized effect names, for CSS hooks and debugging. */
  normalized: 'data-kui-fx',
  state: 'data-kui-state',
  on: 'data-kui-on',
  timeline: 'data-kui-timeline',
  threshold: 'data-kui-threshold',
  stagger: 'data-kui-stagger',
  cloak: 'data-kui-cloak',
  /** Reduced-motion policy, stamped from the primitive so the CSS layer can act on it. */
  rm: 'data-kui-rm',
} as const
