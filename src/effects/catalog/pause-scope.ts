import type { PrepareContext } from '../../core/effect-context.js'
import { continuousSetup, deferPrepare } from '../../core/instances.js'
import type { SetupResult } from '../../core/instances.js'
import { createAttributeLedger } from '../../core/owned-styles.js'
import type { AttributeLedger } from '../../core/owned-styles.js'
import type { Registry } from '../../core/registry.js'
import { announcePauseScope, PAUSE_SCOPE_ATTR } from '../../core/pause-scope.js'
import { attributeChannel } from '../../core/types.js'
import type { EffectParams, ParameterSchema, Preset, Primitive } from '../../core/types.js'
import { PAUSE_PARAM } from '../auto-motion.js'
import { bindControl, delegateControls } from '../step-index.js'
import { queryControls, resolveTarget } from '../../core/target.js'
import { withTimingContract } from '../shared.js'

const pauseScopeParams: ParameterSchema = {
  pause: PAUSE_PARAM,
  paused: { type: 'keyword', default: 'false', cssProperty: '--kui-paused', keywords: ['false', 'true'] },
}

function animationsOf(el: Element): Animation[] {
  const getAnimations = (el as Element & { getAnimations?: Element['getAnimations'] }).getAnimations
  return typeof getAnimations === 'function' ? getAnimations.call(el, { subtree: true }) : []
}

/**
 * A script animation: one a page or the library started through `element.animate()`.
 *
 * `CSSAnimation` and `CSSTransition` carry `animationName` / `transitionProperty`; a plain
 * `Animation` carries neither. Duck-typed so it holds across realms and in a DOM with no
 * `CSSAnimation` constructor. Stylesheet motion is frozen by the `[data-kui-paused]` rule in
 * `base.css` instead, because the animator's own gate writes `animation-play-state` inline.
 */
function isScriptAnimation(animation: Animation): boolean {
  return !('animationName' in animation) && !('transitionProperty' in animation)
}

function preparePauseScope(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  const doc = ctx.doc
  const attrs = createAttributeLedger(el)
  const controlLedgers = new Map<Element, AttributeLedger>()
  const held = new Set<Animation>()
  const selector = resolveTarget(params.text('pause'), ctx, 'pause-scope pause')
  let paused = params.is('paused', 'true')

  const reflectControls = (): void => {
    if (!selector) return
    for (const node of queryControls(el, ctx, selector)) {
      const ledger = controlLedgers.get(node) ?? createAttributeLedger(node)
      controlLedgers.set(node, ledger)
      ledger.set('aria-pressed', String(paused))
    }
  }
  const holdScripts = (): void => {
    for (const animation of animationsOf(el)) {
      // Scroll- and view-timeline animations follow scroll position; pausing one would detach it.
      if (animation.timeline !== doc.timeline || !isScriptAnimation(animation)) continue
      if (animation.playState !== 'running') continue
      animation.pause()
      held.add(animation)
    }
  }
  const releaseScripts = (): void => {
    for (const animation of held) {
      // Skipped if something else finished or cancelled it meanwhile; play() on those would restart.
      if (animation.playState === 'paused') animation.play()
    }
    held.clear()
  }
  const apply = (): void => {
    if (paused) {
      attrs.set(PAUSE_SCOPE_ATTR, '')
      holdScripts()
    } else {
      attrs.remove(PAUSE_SCOPE_ATTR)
      releaseScripts()
    }
    reflectControls()
    announcePauseScope(doc, el)
  }

  const group = selector ? bindControl({ el, ctx, params, label: 'pause-scope' }, 'pause', () => {
    paused = !paused
    apply()
  }) : null
  const unbind = delegateControls({ el, ctx, groups: group ? [group] : [] })
  if (paused) apply()
  else reflectControls()

  return continuousSetup(() => {
    unbind()
    const wasPaused = paused
    paused = false
    releaseScripts()
    attrs.restore()
    for (const ledger of controlLedgers.values()) ledger.restore()
    controlLedgers.clear()
    if (wasPaused) announcePauseScope(doc, el)
  })
}

/**
 * Pauses everything under a container from the author's own button.
 *
 * Writes `data-kui-paused` on the host (the stylesheet freezes every CSS animation beneath it and
 * every scheduler reads it through `isPausedByScope`), holds the subtree's script animations,
 * mirrors `aria-pressed` onto each `pause:` control, and announces each change so schedulers
 * re-evaluate. It is a control, so it keeps working under reduced motion.
 */
export const PAUSE_SCOPE_PRIMITIVE: Primitive = {
  id: 'pause-scope',
  renderer: 'javascript',
  channels: [attributeChannel(PAUSE_SCOPE_ATTR)],
  parameters: pauseScopeParams,
  supportedTimelines: ['time'],
  supportedActivations: ['load', 'manual'],
  defaultActivation: 'load',
  perfClass: 'compositor',
  reducedMotion: 'shorten',
  prepare: withTimingContract(
    'pause-scope',
    { because: 'it is a control that holds other motion rather than defining an animation' },
    deferPrepare(preparePauseScope),
  ),
}

export const PAUSE_SCOPE_PRESETS: Preset[] = [{ name: 'pause-scope', primitive: 'pause-scope', phase: 'state' }]

/**
 * Register the section-wide pause control.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(1) time and space.
 */
export function registerPauseScope(registry: Registry): Registry {
  return registry.registerPrimitives([PAUSE_SCOPE_PRIMITIVE]).registerPresets(PAUSE_SCOPE_PRESETS)
}
