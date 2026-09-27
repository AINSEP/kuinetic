//
// The Skeleton (§1 of target-phases-2-9.md) creates every new module `target:`-everywhere's later
// phases will fill in, each as an inert stub. This file is the backstop that keeps `npm run
// lint:dead` from flagging those stubs as unused exports before a phase lands to call them, and
// that every module's shape (a plain function, importable from the path its phase owns) is in place
// for the next agent to build against — nothing here asserts a stub's *return value*, since every
// phase is free to change those without touching this file.
import { describe, expect, it } from 'vitest'
import * as aggregate from '../src/core/derived/aggregate.js'
import * as book from '../src/core/derived/book.js'
import * as diagnostics from '../src/core/derived/diagnostics.js'
import * as groupGate from '../src/core/derived/group-gate.js'
import * as install from '../src/core/derived/install.js'
import * as lateMatches from '../src/core/derived/late-matches.js'
import * as cloakSelectors from '../src/core/cloak-selectors.js'
import * as staggerKeys from '../src/core/stagger-keys.js'
import * as unquotedSelectors from '../src/core/unquoted-selectors.js'
import * as flipParts from '../src/effects/three-d/flip-parts.js'
import * as iconParts from '../src/effects/svg/icon-parts.js'

describe('target-everywhere skeleton exports', () => {
  it.each([
    ['installWithTargets', install.installWithTargets],
    ['releaseDerived', install.releaseDerived],
    ['restageAfterTreeRelease', install.restageAfterTreeRelease],
    ['claimMatches', install.claimMatches],
    ['installDerivedMatches', install.installDerivedMatches],
    ['restageTargets', install.restageTargets],
    ['syncAggregate', aggregate.syncAggregate],
    ['compileUnion', aggregate.compileUnion],
    ['groupGateOwner', groupGate.groupGateOwner],
    ['skipsOwnBinding', groupGate.skipsOwnBinding],
    ['bindGroups', groupGate.bindGroups],
    ['markUnmatched', diagnostics.markUnmatched],
    ['warnNested3d', diagnostics.warnNested3d],
    ['warnPageScopeCloak', diagnostics.warnPageScopeCloak],
    ['adoptLateMatches', lateMatches.adoptLateMatches],
    ['createDerivedBook', book.createDerivedBook],
    ['derivedOf', book.derivedOf],
    ['hostOf', book.hostOf],
    ['elementStaggerKeys', staggerKeys.elementStaggerKeys],
    ['staggerKeysFor', staggerKeys.staggerKeysFor],
    ['isGroupedKeys', staggerKeys.isGroupedKeys],
    ['claimTargetGroupHost', staggerKeys.claimTargetGroupHost],
    ['isTargetGroupHost', staggerKeys.isTargetGroupHost],
    ['findUnquotedSelectors', unquotedSelectors.findUnquotedSelectors],
    ['unquotedSelectorWarning', unquotedSelectors.unquotedSelectorWarning],
    ['cloakSelector', cloakSelectors.cloakSelector],
    ['gateReleaseSelector', cloakSelectors.gateReleaseSelector],
    ['prepareFlipParts', flipParts.prepareFlipParts],
    ['withIconParts', iconParts.withIconParts],
  ])('%s is a function', (_name, fn) => expect(typeof fn).toBe('function'))
})
