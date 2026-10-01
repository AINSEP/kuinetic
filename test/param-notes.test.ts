import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { describeEffect, describeKeys, KEY_NOTE_OWNER } from '../src/core/describe.js'
import type { ParamNotes } from '../src/core/describe.js'
import type { ParamNote } from '../src/core/types.js'
import { createRegistry } from '../src/effects/index.js'
import { PARAM_NOTES } from '../src/notes/index.js'

/**
 * Keeps the plain-words notes table (`src/notes/`) in step with the registry, in both directions.
 *
 * Everything is derived from `createRegistry()`; nothing here counts. A parameter added to any
 * primitive fails the first test until someone writes its note, and a note left behind by a
 * renamed or removed parameter fails the second.
 */
const registry = createRegistry()
const NOTES_DIR = fileURLToPath(new URL('../src/notes/', import.meta.url))

function why(note: ParamNote): string {
  return typeof note === 'string' ? note : note.why
}

describe('parameter notes', () => {
  it('every parameter of every registered name has a note', () => {
    const missing: string[] = []
    for (const name of registry.names()) {
      const described = describeEffect(registry, name, PARAM_NOTES)!
      for (const param of described.params) {
        if (!param.note) missing.push(`${name}.${param.name} (primitive ${described.primitive})`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every reserved data-kui key has a note', () => {
    const missing = describeKeys(PARAM_NOTES).filter((key) => !key.note || !key.whenOmitted)
    expect(missing.map((key) => key.name)).toEqual([])
  })

  it('every key names a parameter that exists', () => {
    const reservedKeys = new Set(describeKeys().map((key) => key.name))
    const presets = new Set(registry.names())
    const declared = new Map<string, Set<string>>()
    const anyDeclares = new Set<string>()
    for (const name of presets) {
      const { preset, primitive } = registry.resolve(name)!
      const params = Object.keys(primitive.parameters)
      declared.set(preset.name, new Set(params))
      declared.set(primitive.id, new Set(params))
      for (const param of params) anyDeclares.add(param)
    }
    const stale = Object.keys(PARAM_NOTES).filter((key) => {
      const dot = key.indexOf('.')
      const owner = key.slice(0, dot)
      const param = key.slice(dot + 1)
      if (owner === '*') return !anyDeclares.has(param)
      if (owner === KEY_NOTE_OWNER) return !reservedKeys.has(param)
      return !declared.get(owner)?.has(param)
    })
    expect(stale).toEqual([])
  })

  it('no key is written twice across the family files', async () => {
    const seen = new Map<string, string>()
    const duplicates: string[] = []
    const files = readdirSync(NOTES_DIR).filter((file) => file.endsWith('.ts') && file !== 'index.ts')
    for (const file of files) {
      const module = (await import(`${NOTES_DIR}${file}`)) as Record<string, ParamNotes>
      const keys = Object.values(module).flatMap((table) => Object.keys(table))
      for (const key of keys) {
        if (seen.has(key)) duplicates.push(`${key} in ${seen.get(key)} and ${file}`)
        seen.set(key, file)
      }
    }
    expect(duplicates).toEqual([])
    // And index.ts spreads every family: a file it forgot would leave its notes unreachable.
    const byName = (a: string, b: string) => a.localeCompare(b)
    expect(Object.keys(PARAM_NOTES).sort(byName)).toEqual([...seen.keys()].sort(byName))
  })

  it('every note is one short plain sentence', () => {
    const problems: string[] = []
    for (const [key, note] of Object.entries(PARAM_NOTES)) {
      const texts = typeof note === 'string' ? [note] : [note.why, note.whenOmitted ?? '.']
      for (const text of texts) {
        if (text.length > 120 || /\n/.test(text) || !/[.!?]$/.test(text)) problems.push(`${key}: ${text}`)
      }
      if (/\b(custom property|keyframe|primitive|DOM|boolean)\b/i.test(why(note))) {
        problems.push(`${key} uses jargon: ${why(note)}`)
      }
    }
    expect(problems).toEqual([])
  })
})
