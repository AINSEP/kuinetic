import type { Preset, Primitive } from './types.js'

export interface ResolvedEffect {
  preset: Preset
  primitive: Primitive
}

/**
 * Name → primitive alias table.
 *
 * The catalog's ~237 names come from 29 primitives; 48 of them are one primitive with different
 * parameter defaults. Presets are therefore data rows, not code, and adding a name in a later
 * release costs a table entry. See docs/catalog.md.
 */
export class Registry {
  private primitives = new Map<string, Primitive>()
  private presets = new Map<string, Preset>()
  /** Sorted-name key → preset that renders that combination as one tested keyframe. */
  private combos = new Map<string, string>()

  registerPrimitive(primitive: Primitive): this {
    if (this.primitives.has(primitive.id)) {
      throw new Error(`designimation: primitive "${primitive.id}" is already registered`)
    }
    this.primitives.set(primitive.id, primitive)
    return this
  }

  registerPreset(preset: Preset): this {
    if (this.presets.has(preset.name)) {
      throw new Error(`designimation: effect "${preset.name}" is already registered`)
    }
    if (!this.primitives.has(preset.primitive)) {
      throw new Error(
        `designimation: effect "${preset.name}" references unknown primitive "${preset.primitive}"`,
      )
    }
    this.presets.set(preset.name, preset)
    return this
  }

  registerPresets(presets: Preset[]): this {
    for (const preset of presets) this.registerPreset(preset)
    return this
  }

  /**
   * Declare that a set of effect names has a purpose-built single-keyframe implementation.
   * Checked before channel conflict analysis, so `fade-up` + `blur-in` can resolve to the
   * tested `fade-blur-up` rather than being rejected for both writing `opacity`.
   */
  registerCombo(names: string[], presetName: string): this {
    this.combos.set(comboKey(names), presetName)
    return this
  }

  resolve(name: string): ResolvedEffect | undefined {
    const preset = this.presets.get(name)
    if (!preset) return undefined
    const primitive = this.primitives.get(preset.primitive)
    if (!primitive) return undefined
    return { preset, primitive }
  }

  findCombo(names: string[]): ResolvedEffect | undefined {
    const comboName = this.combos.get(comboKey(names))
    return comboName ? this.resolve(comboName) : undefined
  }

  has(name: string): boolean {
    return this.presets.has(name)
  }

  /** All registered effect names, for docs generation and dev-mode "did you mean" hints. */
  names(): string[] {
    return [...this.presets.keys()].sort((a, b) => a.localeCompare(b))
  }

  getPrimitive(id: string): Primitive | undefined {
    return this.primitives.get(id)
  }
}

function comboKey(names: string[]): string {
  return [...names].sort((a, b) => a.localeCompare(b)).join('+')
}

/** Levenshtein-lite suggestion for unknown effect names. Dev-mode ergonomics only. */
export function suggest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined
  let bestScore = Infinity
  for (const candidate of candidates) {
    const score = distance(name, candidate)
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return bestScore <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined
}

function distance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  let prev = Array.from({ length: cols }, (_, i) => i)
  for (let i = 1; i < rows; i++) {
    const curr = [i, ...Array<number>(cols - 1).fill(0)]
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
    }
    prev = curr
  }
  return prev[cols - 1]!
}
