import { describe, expect, it } from 'vitest'
import {
  computeInsertion,
  extractBibResources,
  findCiteAtCursor,
  parseKeyHint,
  seedTokenAtCursor,
} from './citation'

const cur = (s: string) => {
  const cursor = s.indexOf('|')
  return { doc: s.replace('|', ''), cursor }
}

describe('findCiteAtCursor', () => {
  it('detects cursor inside \\cite braces', () => {
    const { doc, cursor } = cur('text \\cite{smith|2020} more')
    const ctx = findCiteAtCursor(doc, cursor)
    expect(ctx?.command).toBe('cite')
    expect(ctx?.tokens.map((t) => t.text)).toEqual(['smith2020'])
  })

  it('detects citep/citet variants and starred forms', () => {
    for (const cmd of ['citep', 'citet', 'citep*', 'parencite', 'autocite']) {
      const { doc, cursor } = cur(`\\${cmd}{a|}`)
      expect(findCiteAtCursor(doc, cursor)).not.toBeNull()
    }
  })

  it('handles optional arguments', () => {
    const { doc, cursor } = cur('\\citep[see][p. 4]{smith|}')
    expect(findCiteAtCursor(doc, cursor)?.tokens[0]?.text).toBe('smith')
  })

  it('returns null outside braces', () => {
    const { doc, cursor } = cur('\\cite{a} te|xt')
    expect(findCiteAtCursor(doc, cursor)).toBeNull()
  })

  it('returns null for non-cite commands', () => {
    const { doc, cursor } = cur('\\textbf{bo|ld}')
    expect(findCiteAtCursor(doc, cursor)).toBeNull()
  })

  it('tokenizes multiple keys with offsets', () => {
    const { doc, cursor } = cur('\\cite{a, b|b, c}')
    const ctx = findCiteAtCursor(doc, cursor)!
    expect(ctx.tokens.map((t) => t.text)).toEqual(['a', 'bb', 'c'])
    expect(doc.slice(ctx.tokens[1]!.start, ctx.tokens[1]!.end)).toBe('bb')
  })
})

describe('computeInsertion', () => {
  const apply = (s: string, key: string, cmd = 'citep') => {
    const { doc, cursor } = cur(s)
    const ins = computeInsertion(doc, cursor, key, cmd)
    const out = doc.slice(0, ins.from) + ins.insert + doc.slice(ins.to)
    return out.slice(0, ins.cursor) + '|' + out.slice(ins.cursor)
  }

  it('wraps in default command outside a cite, gluing with ~, cursor inside braces', () => {
    expect(apply('hello | world', 'k1')).toBe('hello~\\citep{k1|} world')
  })

  it('absorbs preceding spaces into the tilde', () => {
    expect(apply('hello   |', 'k1')).toBe('hello~\\citep{k1|}')
  })

  it('skips the tilde at line start and after opening brackets or tilde', () => {
    expect(apply('|', 'k1')).toBe('\\citep{k1|}')
    expect(apply('line one\n|', 'k1')).toBe('line one\n\\citep{k1|}')
    expect(apply('(|', 'k1')).toBe('(\\citep{k1|}')
    expect(apply('word~|', 'k1')).toBe('word~\\citep{k1|}')
  })

  it('adds a trailing space when a word follows immediately', () => {
    expect(apply('hello |world', 'k1')).toBe('hello~\\citep{k1|} world')
    expect(apply('hello |.', 'k1')).toBe('hello~\\citep{k1|}.')
  })

  it('fills empty braces', () => {
    expect(apply('\\citep{|}', 'k1')).toBe('\\citep{k1|}')
  })

  it('replaces token when cursor strictly inside it', () => {
    expect(apply('\\cite{sm|ith}', 'smith2020')).toBe('\\cite{smith2020|}')
  })

  it('appends after a complete key (multi-cite repeat flow)', () => {
    expect(apply('\\citep{k1|}', 'k2')).toBe('\\citep{k1, k2|}')
  })

  it('prepends before a key', () => {
    expect(apply('\\citep{|k1}', 'k0')).toBe('\\citep{k0|, k1}')
  })

  it('fills the empty segment after a comma', () => {
    expect(apply('\\cite{a, |, c}', 'b')).toBe('\\cite{a, b|, c}')
  })

  it('preserves other keys when replacing a middle token', () => {
    expect(apply('\\cite{a, b|b, c}', 'B')).toBe('\\cite{a, B|, c}')
  })
})

describe('seedTokenAtCursor', () => {
  it('returns token only when cursor is strictly inside', () => {
    const inside = cur('\\cite{smi|th}')
    expect(seedTokenAtCursor(inside.doc, inside.cursor)?.text).toBe('smith')
    const boundary = cur('\\cite{smith|}')
    expect(seedTokenAtCursor(boundary.doc, boundary.cursor)).toBeNull()
  })
})

describe('parseKeyHint', () => {
  it('splits author-year keys', () => {
    expect(parseKeyHint('Smith2020a')).toBe('smith 2020')
    expect(parseKeyHint('vaswani2017attention')).toBe('vaswani 2017 attention')
    expect(parseKeyHint('smith-jones_2020')).toBe('smith jones 2020')
  })

  it('drops non-year numbers', () => {
    expect(parseKeyHint('alexnet12')).toBe('alexnet')
  })

  it('splits camel case', () => {
    expect(parseKeyHint('DevlinBert2019')).toBe('devlin bert 2019')
  })
})

describe('extractBibResources', () => {
  it('parses \\bibliography with multiple files', () => {
    expect(extractBibResources('\\bibliography{refs, other.bib}')).toEqual([
      'refs.bib',
      'other.bib',
    ])
  })

  it('parses \\addbibresource', () => {
    expect(extractBibResources('\\addbibresource{main.bib}')).toEqual(['main.bib'])
  })

  it('dedupes', () => {
    expect(
      extractBibResources('\\bibliography{refs}\n\\bibliography{refs}')
    ).toEqual(['refs.bib'])
  })
})
