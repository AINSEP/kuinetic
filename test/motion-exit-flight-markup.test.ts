import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { catalogRegistry } from './support/registry.js'

const examples = [
  'flip-reorder leave:fade 300ms',
  'underline-draw position:50% 300ms on:click',
  'number-formatting attribute:data-value 400ms',
  'lightbox flight:true',
  'image-flight image:img destination:#basket lift:60px on:click',
  'image-flight image:.lane-c-product destination:#lane-c-basket lift:60px on:click',
  'image-flight image:.product destination:#basket lift:60px on:click',
  'ripple extent:2 startScale:1 450ms',
]

describe('Exact exit, number and flight declarations', () => {
  it('compiles all eight exact declarations without warnings', () => {
    for (const value of examples) expect(compile(parse(value), catalogRegistry(), 'time').warnings).toEqual([])
  })
})
