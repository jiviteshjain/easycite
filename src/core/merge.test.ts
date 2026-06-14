import { describe, expect, it } from 'vitest'
import { mergeResults, rerankByQuery } from './merge'
import type { MergedResult, Paper } from './types'

const paper = (over: Partial<Paper>): Paper => ({
  sourceId: 'dblp',
  id: 'x',
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani'],
  year: 2017,
  venue: 'NeurIPS',
  official: true,
  bibtexSource: 'dblp',
  bibtexRef: 'conf/nips/Vaswani17',
  ...over,
})

describe('mergeResults', () => {
  it('groups official and preprint versions of the same paper', () => {
    const official = paper({})
    const preprint = paper({
      id: 'corr',
      venue: 'arXiv',
      official: false,
      bibtexSource: 'arxiv',
      bibtexRef: '1706.03762',
    })
    const results = mergeResults([preprint, official], true)
    expect(results).toHaveLength(1)
    expect(results[0]!.primary).toBe(official)
    expect(results[0]!.alternate).toBe(preprint)
  })

  it('tolerates punctuation/case title differences and ±2 year drift', () => {
    const a = paper({ title: 'Attention is all you need!', year: 2017 })
    const b = paper({ id: 'b', title: 'Attention Is All You Need', year: 2019, official: false })
    expect(mergeResults([a, b], true)).toHaveLength(1)
  })

  it('keeps different papers separate', () => {
    const a = paper({})
    const b = paper({ id: 'y', title: 'BERT: Pre-training of Deep Bidirectional Transformers' })
    expect(mergeResults([a, b], true)).toHaveLength(2)
  })

  it('separates same-title papers by different first authors', () => {
    const a = paper({})
    const b = paper({ id: 'y', authors: ['Jane Doe'] })
    expect(mergeResults([a, b], true)).toHaveLength(2)
  })

  it('ranks ACL above generic dblp within a group', () => {
    const acl = paper({ id: 'acl', bibtexSource: 'acl', bibtexRef: 'P19-1334' })
    const dblp = paper({ id: 'dblp' })
    expect(mergeResults([dblp, acl], true)[0]!.primary.id).toBe('acl')
  })

  it('preserves first-appearance order across groups', () => {
    const first = paper({ id: '1', title: 'Paper One' })
    const second = paper({ id: '2', title: 'Paper Two' })
    const results = mergeResults([first, second], true)
    expect(results.map((r) => r.primary.id)).toEqual(['1', '2'])
  })

  it('prefers preprint as primary when preferOfficial is false', () => {
    const official = paper({})
    const preprint = paper({
      id: 'corr',
      official: false,
      bibtexSource: 'arxiv',
      bibtexRef: '1706.03762',
    })
    // provenance rank: dblp > arxiv, so official still wins unless ranks differ
    const results = mergeResults([preprint, official], false)
    expect(results[0]!.primary.bibtexSource).toBe('dblp')
  })
})

describe('local entries in merge', () => {
  const local = (over: Partial<Paper>): Paper =>
    paper({ sourceId: 'local', bibtexSource: 'local', bibtexRef: 'vaswani2017attention', ...over })

  it('local always represents its group, even a preprint local vs official remote', () => {
    const localArxiv = local({ id: 'k', official: false, venue: 'arXiv' })
    const officialRemote = paper({ id: 'dblp1' })
    const results = mergeResults([localArxiv, officialRemote], true)
    expect(results).toHaveLength(1)
    expect(results[0]!.primary).toBe(localArxiv)
  })

  it('local wins regardless of preferOfficial', () => {
    const l = local({ id: 'k' })
    const remote = paper({ id: 'dblp1' })
    expect(mergeResults([remote, l], false)[0]!.primary).toBe(l)
  })
})

it('tiebreaks equal-rank duplicates toward the one with inline bibtex', () => {
  const without = paper({ id: 'or1', sourceId: 'openreview', bibtexSource: 'openreview' })
  const withBib = paper({
    id: 'or2',
    sourceId: 'openreview',
    bibtexSource: 'openreview',
    inlineBibtex: '@inproceedings{k, title={Attention Is All You Need}}',
  })
  expect(mergeResults([without, withBib], true)[0]!.primary).toBe(withBib)
})

it('ranks crossref records below specialist sources but above bare arxiv', () => {
  const fromArxiv = paper({ id: 'a', official: false, bibtexSource: 'arxiv' })
  const fromCrossref = paper({ id: 'c', official: false, sourceId: 'crossref', bibtexSource: 'crossref' })
  const fromDblp = paper({ id: 'd', official: false, bibtexSource: 'dblp' })
  const merged = mergeResults([fromArxiv, fromCrossref, fromDblp], true)
  expect(merged).toHaveLength(1)
  expect(merged[0]!.primary).toBe(fromDblp)
  const onlyTwo = mergeResults([fromArxiv, fromCrossref], true)
  expect(onlyTwo[0]!.primary).toBe(fromCrossref)
})

describe('rerankByQuery', () => {
  const make = (title: string, authors: string[] = ['A B']) =>
    ({ primary: paper({ id: title, title, authors }) }) as MergedResult

  it('pulls a title-token match above unrelated higher-ranked papers', () => {
    const r = rerankByQuery(
      [
        make('Incentivizing LLMs to Self-Verify Their Answers'),
        make('DINO-R1: Incentivizing Reasoning Capability in Vision Foundation Model'),
        make('DeepSeek-R1: Incentivizing Reasoning Capability in LLMs'),
        make('When Large Language Models are More Persuasive Than Incentivized Humans'),
      ],
      'deepseek ai incentivizing'
    )
    expect(r[0]!.primary.title).toBe('DeepSeek-R1: Incentivizing Reasoning Capability in LLMs')
  })

  it('rewards contiguous title matches', () => {
    const r = rerankByQuery(
      [make('Wide and Tall Other Paper'), make('Attention Is All You Need')],
      'attention is all you need'
    )
    expect(r[0]!.primary.title).toBe('Attention Is All You Need')
  })

  it('rewards author-name matches when title does not overlap', () => {
    const r = rerankByQuery(
      [make('Something Else', ['Random Person']), make('Quirky Title', ['Ashish Vaswani', 'Co'])],
      'vaswani'
    )
    expect(r[0]!.primary.authors[0]).toBe('Ashish Vaswani')
  })

  it('preserves first-appearance order on a tie', () => {
    const r = rerankByQuery(
      [make('A Paper About Transformers'), make('Another Paper About Transformers')],
      'paper transformers'
    )
    expect(r.map((x) => x.primary.title)).toEqual([
      'A Paper About Transformers',
      'Another Paper About Transformers',
    ])
  })

  it('is a no-op for an empty query', () => {
    const a = make('A')
    const b = make('B')
    expect(rerankByQuery([a, b], '   ')).toEqual([a, b])
  })
})
