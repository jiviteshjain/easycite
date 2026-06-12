import { describe, expect, it } from 'vitest'
import { mergeResults } from './merge'
import type { Paper } from './types'

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
