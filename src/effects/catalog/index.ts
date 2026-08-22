import type { Registry } from '../../core/registry.js'
import { registerAmbient } from './ambient.js'
import { registerFeedback } from './feedback.js'
import { registerInteraction } from './interaction.js'
import { registerMedia } from './media.js'
import { registerNumbers } from './numbers.js'
import { registerText } from './text.js'

/**
 * Register the CSS-oriented catalog sections.
 *
 * Delegates to each section's own `register*` function — the same shape every other top-level
 * category (`registerGestures`, `registerThreeD`, ...) uses — instead of re-registering their
 * constants inline, so this aggregator and each section's own registration path can never drift
 * apart from each other.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets.
 * @overallScore 100
 */
export function registerCatalog(registry: Registry): Registry {
  registerMedia(registry)
  registerText(registry)
  registerAmbient(registry)
  registerFeedback(registry)
  registerNumbers(registry)
  registerInteraction(registry)
  return registry
}
