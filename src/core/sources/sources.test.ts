import { describe, expect, it } from 'vitest'
import * as dblp from './dblp'
import * as arxiv from './arxiv'
import * as openreview from './openreview'

const DBLP_FIXTURE = JSON.stringify({
  result: {
    hits: {
      hit: [
        {
          info: {
            title: 'Attention is All you Need.',
            authors: {
              author: [{ text: 'Ashish Vaswani' }, { text: 'Wei Li 0002' }],
            },
            venue: 'NIPS',
            year: '2017',
            type: 'Conference and Workshop Papers',
            key: 'conf/nips/VaswaniSPUJGKP17',
            ee: 'https://doi.org/10.5555/3295222',
          },
        },
        {
          info: {
            title: 'Attention Is All You Need.',
            authors: { author: { text: 'Ashish Vaswani' } },
            venue: 'CoRR',
            year: '2017',
            type: 'Informal and Other Publications',
            key: 'journals/corr/VaswaniSPUJGKP17',
            ee: 'https://arxiv.org/abs/1706.03762',
          },
        },
        {
          info: {
            title: 'BERT: Pre-training of Deep Bidirectional Transformers.',
            authors: { author: { text: 'Jacob Devlin' } },
            venue: 'NAACL-HLT',
            year: '2019',
            type: 'Conference and Workshop Papers',
            key: 'conf/naacl/DevlinCLT19',
            ee: 'https://aclanthology.org/N19-1423/',
          },
        },
      ],
    },
  },
})

describe('dblp', () => {
  const papers = dblp.parse(DBLP_FIXTURE)

  it('parses official conference records', () => {
    expect(papers[0]).toMatchObject({
      title: 'Attention is All you Need',
      venue: 'NIPS',
      official: true,
      bibtexSource: 'dblp',
      bibtexRef: 'conf/nips/VaswaniSPUJGKP17',
      year: 2017,
    })
  })

  it('strips dblp author disambiguation suffixes', () => {
    expect(papers[0]!.authors).toEqual(['Ashish Vaswani', 'Wei Li'])
  })

  it('marks CoRR records as arXiv preprints with arxiv bibtex source', () => {
    expect(papers[1]).toMatchObject({
      venue: 'arXiv',
      official: false,
      bibtexSource: 'arxiv',
      bibtexRef: '1706.03762',
    })
  })

  it('routes ACL Anthology papers to acl bibtex', () => {
    expect(papers[2]).toMatchObject({ bibtexSource: 'acl', bibtexRef: 'N19-1423' })
  })

  it('handles empty results', () => {
    expect(dblp.parse('{"result":{"hits":{}}}')).toEqual([])
  })
})

const ARXIV_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title>Attention Is All You Need</title>
    <published>2017-06-12T17:57:34Z</published>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/cs/9901001v1</id>
    <title>Old style identifier &amp; entities</title>
    <published>1999-01-01T00:00:00Z</published>
    <author><name>Some One</name></author>
  </entry>
</feed>`

describe('arxiv', () => {
  const papers = arxiv.parse(ARXIV_FIXTURE)

  it('parses entries, strips version from id', () => {
    expect(papers[0]).toMatchObject({
      id: '1706.03762',
      title: 'Attention Is All You Need',
      year: 2017,
      official: false,
      bibtexRef: '1706.03762',
    })
    expect(papers[0]!.authors).toEqual(['Ashish Vaswani', 'Noam Shazeer'])
  })

  it('handles old-style ids and XML entities', () => {
    expect(papers[1]).toMatchObject({
      id: 'cs/9901001',
      title: 'Old style identifier & entities',
    })
  })

  it('builds AND queries', () => {
    expect(arxiv.buildUrl('attention vaswani')).toContain(
      encodeURIComponent('all:attention AND all:vaswani')
    )
  })
})

const OPENREVIEW_FIXTURE = JSON.stringify({
  notes: [
    {
      id: 'abc123',
      content: {
        title: { value: 'Some Accepted Paper' },
        authors: { value: ['Alice A', 'Bob B'] },
        venue: { value: 'ICLR 2024 oral' },
        venueid: { value: 'ICLR.cc/2024/Conference' },
        _bibtex: { value: '@inproceedings{alice2024some, title={Some Accepted Paper}}' },
      },
    },
    {
      id: 'def456',
      content: {
        title: { value: 'Some Rejected Paper' },
        venue: { value: 'Submitted to ICLR 2026' },
        venueid: { value: 'ICLR.cc/2026/Conference/Rejected_Submission' },
      },
    },
    {
      id: 'ghi789',
      content: {
        title: { value: 'A DBLP Mirror Record' },
        venue: { value: 'CoRR 2024' },
        venueid: { value: 'dblp.org/journals/CORR/2024' },
      },
    },
    {
      id: 'jkl012',
      pdate: 1704067200000, // 2024-01-01
      content: {
        title: { value: 'A Journal Paper' },
        venue: { value: 'Frontiers in Robotics and AI' },
        venueid: { value: 'Frontiers/Robotics_and_AI' },
      },
    },
  ],
})

describe('openreview', () => {
  const papers = openreview.parse(OPENREVIEW_FIXTURE)

  it('marks accepted papers official with inline bibtex and venue year', () => {
    expect(papers[0]).toMatchObject({
      official: true,
      venue: 'ICLR 2024 oral',
      year: 2024,
      inlineBibtex: '@inproceedings{alice2024some, title={Some Accepted Paper}}',
    })
  })

  it('marks submitted/rejected papers as not official', () => {
    expect(papers[1]!.official).toBe(false)
  })

  it('skips DBLP-mirror records (venueid dblp.org/...)', () => {
    expect(papers).toHaveLength(3)
    expect(papers.some((p) => p.title === 'A DBLP Mirror Record')).toBe(false)
  })

  it('falls back to pdate for the year when the venue string has none', () => {
    expect(papers[2]).toMatchObject({ venue: 'Frontiers in Robotics and AI', year: 2024 })
  })

  it('acceptance heuristics', () => {
    expect(openreview.isAccepted('NeurIPS 2023 poster', 'NeurIPS.cc/2023/Conference')).toBe(true)
    expect(openreview.isAccepted('Submitted to TMLR', 'TMLR/Submission')).toBe(false)
    expect(openreview.isAccepted('ICLR 2025', 'ICLR.cc/2025/Conference/Withdrawn_Submission')).toBe(false)
  })
})
