import { describe, expect, it } from 'vitest'
import { matchLocalPapers, parseBibPapers } from './local'

const BIB = `@inproceedings{vaswani2017attention,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and Shazeer, Noam},
  booktitle = {Advances in Neural Information Processing Systems},
  year = {2017},
}

@article{hubinger2024sleeper,
  title = {Sleeper Agents: Training Deceptive {LLMs}},
  author = {Hubinger, Evan},
  journal = {CoRR},
  year = {2024},
}

@misc{smith2023draft,
  title = {A Draft Paper},
  author = {Jane Smith},
  year = {2023},
}

@misc{lee2024eprint,
  title = {An Eprint Paper},
  author = {Lee, Kim},
  archiveprefix = {arXiv},
  eprint = {2401.00001},
  year = {2024},
}
`

describe('parseBibPapers', () => {
  const papers = parseBibPapers(BIB)

  it('extracts title, authors, year, and venue', () => {
    expect(papers[0]).toMatchObject({
      sourceId: 'local',
      bibtexSource: 'local',
      bibtexRef: 'vaswani2017attention',
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      year: 2017,
      venue: 'Advances in Neural Information Processing Systems',
      official: true,
    })
  })

  it('marks CoRR/arXiv entries as not official', () => {
    expect(papers[1]!.official).toBe(false)
    expect(papers[3]).toMatchObject({ venue: 'arXiv', official: false })
  })

  it('marks entries without a venue as not official', () => {
    expect(papers[2]).toMatchObject({ venue: 'unknown venue', official: false })
  })
})

describe('matchLocalPapers', () => {
  const papers = parseBibPapers(BIB)

  it('requires every query token to match', () => {
    expect(matchLocalPapers(papers, 'attention vaswani').map((p) => p.bibtexRef)).toEqual([
      'vaswani2017attention',
    ])
    expect(matchLocalPapers(papers, 'attention nonexistent')).toEqual([])
  })

  it('matches against key, year, and venue too', () => {
    expect(matchLocalPapers(papers, 'sleeper 2024')[0]!.bibtexRef).toBe('hubinger2024sleeper')
    expect(matchLocalPapers(papers, 'smith2023')[0]!.bibtexRef).toBe('smith2023draft')
  })

  it('returns nothing for an empty query', () => {
    expect(matchLocalPapers(papers, '  ')).toEqual([])
  })
})

describe('parseBibPapers url extraction', () => {
  it('uses an explicit url field', () => {
    const [p] = parseBibPapers(
      `@article{x, title={T}, author={A}, year={2020}, url={https://example.com/foo}}`
    )
    expect(p!.url).toBe('https://example.com/foo')
  })

  it('falls back to a DOI', () => {
    const [p] = parseBibPapers(
      `@article{x, title={T}, author={A}, year={2020}, doi={10.1000/abc}}`
    )
    expect(p!.url).toBe('https://doi.org/10.1000/abc')
  })

  it('strips a doi.org prefix already in the DOI field', () => {
    const [p] = parseBibPapers(
      `@article{x, title={T}, author={A}, year={2020}, doi={https://doi.org/10.1000/abc}}`
    )
    expect(p!.url).toBe('https://doi.org/10.1000/abc')
  })

  it('falls back to arxiv eprint when archiveprefix is arXiv', () => {
    const [p] = parseBibPapers(
      `@article{x, title={T}, author={A}, archiveprefix={arXiv}, eprint={2401.00001}}`
    )
    expect(p!.url).toBe('https://arxiv.org/abs/2401.00001')
  })

  it('leaves url undefined when no source is present', () => {
    const [p] = parseBibPapers(`@misc{x, title={T}, author={A}, year={2020}}`)
    expect(p!.url).toBeUndefined()
  })
})

describe('parseBibPapers howpublished', () => {
  it('extracts a URL wrapped in \\url{}', () => {
    const [p] = parseBibPapers(
      `@misc{x, title={T}, author={A}, howpublished={\\url{https://example.com/x}}}`
    )
    expect(p!.url).toBe('https://example.com/x')
  })

  it('extracts a bare URL', () => {
    const [p] = parseBibPapers(
      `@misc{x, title={T}, author={A}, howpublished={Online at https://example.com/y}}`
    )
    expect(p!.url).toBe('https://example.com/y')
  })

  it('explicit url field still wins over howpublished', () => {
    const [p] = parseBibPapers(
      `@misc{x, title={T}, author={A}, url={https://a/}, howpublished={\\url{https://b/}}}`
    )
    expect(p!.url).toBe('https://a/')
  })
})
