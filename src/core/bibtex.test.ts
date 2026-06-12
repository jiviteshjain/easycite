import { describe, expect, it } from 'vitest'
import {
  extractField,
  generateKey,
  parseEntries,
  planBibInsertion,
  rewriteKey,
} from './bibtex'

const VASWANI = `@inproceedings{vaswani2017attention,
  author    = {Ashish Vaswani and Noam Shazeer and Niki Parmar},
  title     = {Attention is All you Need},
  booktitle = {NeurIPS},
  year      = {2017}
}`

const DEVLIN = `@inproceedings{devlin2019bert,
  author = {Devlin, Jacob and Chang, Ming-Wei},
  title = {{BERT}: Pre-training of Deep Bidirectional Transformers},
  year = {2019}
}`

describe('parseEntries', () => {
  it('parses keys, types and ranges', () => {
    const bib = `${VASWANI}\n\n${DEVLIN}\n`
    const entries = parseEntries(bib)
    expect(entries.map((e) => e.key)).toEqual(['vaswani2017attention', 'devlin2019bert'])
    expect(entries[0]!.type).toBe('inproceedings')
    expect(bib.slice(entries[1]!.start, entries[1]!.end)).toBe(DEVLIN)
  })

  it('skips @string/@comment/@preamble', () => {
    const bib = `@string{acl = "ACL"}\n@comment{ignore}\n${VASWANI}`
    expect(parseEntries(bib).map((e) => e.key)).toEqual(['vaswani2017attention'])
  })

  it('handles nested braces in fields', () => {
    const entries = parseEntries(DEVLIN)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.text).toBe(DEVLIN)
  })
})

describe('extractField', () => {
  it('extracts braced values with nesting', () => {
    expect(extractField(DEVLIN, 'title')).toBe(
      '{BERT}: Pre-training of Deep Bidirectional Transformers'
    )
  })
  it('extracts year', () => {
    expect(extractField(VASWANI, 'year')).toBe('2017')
  })
  it('is case-insensitive on field names', () => {
    expect(extractField('@misc{x, YEAR = {1999}\n}', 'year')).toBe('1999')
  })
})

describe('generateKey', () => {
  it('authorYearWord', () => {
    expect(generateKey(VASWANI, 'authorYearWord')).toBe('vaswani2017attention')
  })
  it('skips stopwords for the title word', () => {
    expect(generateKey(DEVLIN, 'authorYearWord')).toBe('devlin2019bert')
  })
  it('AuthorYear', () => {
    expect(generateKey(VASWANI, 'AuthorYear')).toBe('Vaswani2017')
  })
  it('handles "Surname, First" author format', () => {
    expect(generateKey(DEVLIN, 'AuthorYear')).toBe('Devlin2019')
  })
  it('returns undefined for source format', () => {
    expect(generateKey(VASWANI, 'source')).toBeUndefined()
  })
})

describe('rewriteKey', () => {
  it('replaces only the key', () => {
    const out = rewriteKey(VASWANI, 'newkey')
    expect(out).toContain('@inproceedings{newkey,')
    expect(out).toContain('Attention is All you Need')
  })
})

describe('planBibInsertion', () => {
  it('appends to empty file without leading newlines', () => {
    const plan = planBibInsertion('', VASWANI, 'append')
    expect(plan).toMatchObject({ kind: 'insert', key: 'vaswani2017attention', from: 0 })
  })

  it('appends after the last entry', () => {
    const bib = `${DEVLIN}\n`
    const plan = planBibInsertion(bib, VASWANI, 'append')
    if (plan.kind !== 'insert') throw new Error('expected insert')
    expect(plan.from).toBe(bib.trimEnd().length)
    expect(plan.insert.startsWith('\n\n@inproceedings{vaswani')).toBe(true)
  })

  it('inserts alphabetically by key', () => {
    const bib = `@misc{aaa,\n  title = {A}\n}\n\n@misc{zzz,\n  title = {Z}\n}\n`
    const plan = planBibInsertion(bib, VASWANI, 'alphabetical')
    if (plan.kind !== 'insert') throw new Error('expected insert')
    expect(plan.from).toBe(bib.indexOf('@misc{zzz'))
  })

  it('reuses the existing key when the same paper is present', () => {
    const existing = VASWANI.replace('vaswani2017attention', 'transformer_paper')
    const plan = planBibInsertion(existing, VASWANI, 'append')
    expect(plan).toEqual({ kind: 'exists', key: 'transformer_paper' })
  })

  it('does not treat same-title papers by different authors as duplicates', () => {
    const otherAuthor = VASWANI.replace('Ashish Vaswani and Noam Shazeer and Niki Parmar', 'Jane Doe')
      .replace('vaswani2017attention', 'doe2017attention')
    const plan = planBibInsertion(otherAuthor, VASWANI, 'append')
    expect(plan.kind).toBe('insert')
  })

  it('does not treat same-title papers years apart as duplicates', () => {
    const otherYear = VASWANI.replace('{2017}', '{2010}').replace(
      'vaswani2017attention',
      'vaswani2010attention'
    )
    const plan = planBibInsertion(otherYear, VASWANI, 'append')
    expect(plan.kind).toBe('insert')
  })

  it('renames with the second title word on key collision with a different paper', () => {
    const other = `@misc{vaswani2017attention,\n  title = {Some Other Paper},\n  author = {Other, Ann},\n  year = {2017}\n}`
    const plan = planBibInsertion(other, VASWANI, 'append')
    if (plan.kind !== 'insert') throw new Error('expected insert')
    // title: "Attention is All you Need" -> second significant word is "all"
    expect(plan.key).toBe('vaswani2017attentionall')
    expect(plan.renamedFrom).toBe('vaswani2017attention')
    expect(plan.insert).toContain('@inproceedings{vaswani2017attentionall,')
  })

  it('falls back to letter suffixes when the two-word key is also taken', () => {
    const other = [
      `@misc{vaswani2017attention,\n  title = {Some Other Paper},\n  author = {Other, Ann},\n  year = {2017}\n}`,
      `@misc{vaswani2017attentionall,\n  title = {Yet Another Paper},\n  author = {Third, Tom},\n  year = {2017}\n}`,
    ].join('\n\n')
    const plan = planBibInsertion(other, VASWANI, 'append')
    if (plan.kind !== 'insert') throw new Error('expected insert')
    expect(plan.key).toBe('vaswani2017attentionb')
  })
})
