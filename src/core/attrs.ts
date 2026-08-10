/** Attribute names, in one place so the namespace is a single rename before publish. */
export const ATTR = {
  /** Authored. The rich grammar. */
  source: 'data-dsg',
  /** Library-owned and unstable: normalized effect names, for CSS hooks and debugging. */
  normalized: 'data-dsg-fx',
  state: 'data-dsg-state',
  on: 'data-dsg-on',
  timeline: 'data-dsg-timeline',
  threshold: 'data-dsg-threshold',
  stagger: 'data-dsg-stagger',
  cloak: 'data-dsg-cloak',
  /** Reduced-motion policy, stamped from the primitive so the CSS layer can act on it. */
  rm: 'data-dsg-rm',
} as const
