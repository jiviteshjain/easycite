import { describe, expect, it } from 'vitest'
import * as dblp from './dblp'
import * as arxiv from './arxiv'
import * as openreview from './openreview'
import * as crossref from './crossref'
import * as europepmc from './europepmc'

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
    {
      id: 'mno345',
      content: {
        title: { value: 'A Crossref Mirror Record' },
        venue: { value: 'Crossref' },
        venueid: { value: 'OpenReview.net/Public_Article' },
      },
    },
    {
      id: 'pqr678',
      content: {
        title: { value: 'An Author-Archived Record' },
        venue: { value: 'Some Freetext Venue Description' },
        venueid: { value: 'OpenReview.net/Archive' },
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

  it('skips Crossref mirrors and author archives (venueid OpenReview.net/...)', () => {
    expect(papers.some((p) => p.title === 'A Crossref Mirror Record')).toBe(false)
    expect(papers.some((p) => p.title === 'An Author-Archived Record')).toBe(false)
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

describe('arxiv buildUrl category filtering', () => {
  const decode = (url: string) => decodeURIComponent(url.split('search_query=')[1]!.split('&')[0]!)

  it('adds no cat clause when all groups (or none) are selected', () => {
    expect(
      decode(arxiv.buildUrl('deep learning', { arxivCategories: [...arxiv.ARXIV_GROUP_IDS] }))
    ).toBe('all:deep AND all:learning')
    expect(decode(arxiv.buildUrl('deep learning'))).toBe('all:deep AND all:learning')
    expect(decode(arxiv.buildUrl('deep learning', { arxivCategories: [] }))).toBe(
      'all:deep AND all:learning'
    )
  })

  it('restricts to selected groups with cat: wildcards', () => {
    const q = decode(arxiv.buildUrl('games', { arxivCategories: ['econ', 'stat'] }))
    expect(q).toBe('(all:games) AND (cat:econ* OR cat:stat*)')
  })

  it('expands the physics group into its archive prefixes', () => {
    const q = decode(arxiv.buildUrl('entanglement', { arxivCategories: ['physics'] }))
    expect(q).toContain('cat:quant-ph*')
    expect(q).toContain('cat:astro-ph*')
    expect(q).toContain('cat:hep-th*')
    expect(q).not.toContain('cat:cs*')
  })

  it('ignores unknown group names', () => {
    expect(decode(arxiv.buildUrl('games', { arxivCategories: ['nonsense'] }))).toBe('all:games')
  })
})

// Hand-written fixture matching the documented/observed Crossref item shape.
const CROSSREF_FIXTURE = JSON.stringify({
  message: {
    items: [
      {
        DOI: '10.1000/jrnl.2021.42',
        type: 'journal-article',
        title: ['A Study of Solar Panel Efficiency'],
        author: [
          { given: 'Ada', family: 'Lovelace' },
          { given: 'Charles', family: 'Babbage' },
        ],
        'container-title': ['Renewable Energy Letters'],
        issued: { 'date-parts': [[2021, 6]] },
        URL: 'https://doi.org/10.1000/jrnl.2021.42',
      },
      {
        DOI: '10.1000/preprint.99',
        type: 'posted-content',
        title: ['A Preprint About Bridges'],
        author: [{ given: 'Grace', family: 'Hopper' }],
        'container-title': [],
        issued: { 'date-parts': [[2024]] },
      },
      {
        DOI: '10.1000/data.7',
        type: 'dataset',
        title: ['Some Dataset'],
        issued: { 'date-parts': [[2020]] },
      },
      {
        DOI: '10.1000/conf.5',
        type: 'proceedings-article',
        title: ['Compilers  for\n Toasters'],
        author: [{ family: 'Turing' }],
        'container-title': ['Intl. Conf. on Appliances'],
        issued: { 'date-parts': [[2019]] },
      },
      { type: 'journal-article', title: [], issued: {} },
    ],
  },
})

describe('crossref', () => {
  const papers = crossref.parse(CROSSREF_FIXTURE)

  it('maps journal articles as official with article bibType', () => {
    expect(papers[0]).toMatchObject({
      sourceId: 'crossref',
      title: 'A Study of Solar Panel Efficiency',
      authors: ['Ada Lovelace', 'Charles Babbage'],
      year: 2021,
      venue: 'Renewable Energy Letters',
      official: true,
      bibType: 'article',
      bibtexSource: 'crossref',
      bibtexRef: '10.1000/jrnl.2021.42',
      url: 'https://doi.org/10.1000/jrnl.2021.42',
    })
  })

  it('marks posted-content as preprint, not official', () => {
    expect(papers[1]).toMatchObject({ venue: 'preprint', official: false, bibType: 'misc' })
  })

  it('skips datasets and items without title or DOI', () => {
    expect(papers).toHaveLength(3)
    expect(papers.some((p) => p.title === 'Some Dataset')).toBe(false)
  })

  it('normalizes whitespace in titles and handles missing given names', () => {
    expect(papers[2]).toMatchObject({
      title: 'Compilers for Toasters',
      authors: ['Turing'],
      bibType: 'inproceedings',
    })
  })

  it('builds a search url capped at 5 rows; omits mailto without an email', () => {
    const url = crossref.buildUrl('solar panels')
    expect(url).toContain('api.crossref.org/works?query.bibliographic=solar%20panels')
    expect(url).toContain('rows=5')
    expect(url).not.toContain('mailto')
  })

  it('opts into the polite pool when an email is provided', () => {
    const url = crossref.buildUrl('solar panels', { politeEmail: 'a+b@example.com' })
    expect(url).toContain('mailto=a%2Bb%40example.com')
  })

  it('declares POLITE_POOL = true', () => {
    expect(crossref.POLITE_POOL).toBe(true)
  })

  it('builds a DOI transform bibtex url', () => {
    expect(crossref.bibtexUrl('10.1000/jrnl.2021.42')).toBe(
      'https://api.crossref.org/works/10.1000%2Fjrnl.2021.42/transform/application/x-bibtex'
    )
  })
})

// Hand-written fixture matching the observed Europe PMC lite result shape.
const EPMC_FIXTURE = JSON.stringify({
  resultList: {
    result: [
      {
        id: '12345678',
        source: 'MED',
        pmid: '12345678',
        doi: '10.1000/jrnl.2022.7',
        title: 'Machine learning for electricity demand forecasting.',
        authorString: 'Lovelace A, Babbage C, Noether E.',
        journalTitle: 'Energy Systems J',
        pubYear: '2022',
      },
      {
        id: 'PPR000111',
        source: 'PPR',
        doi: '10.1000/rs.123',
        title: 'A Preprint on Wind Turbine Maintenance',
        authorString: 'Hopper G.',
        pubYear: '2026',
      },
      {
        id: '99887766',
        source: 'MED',
        title: 'An Old Article Without a DOI',
        authorString: 'Curie M.',
        journalTitle: 'Hist. Sci.',
        pubYear: '1999',
      },
      { source: 'MED' },
    ],
  },
})

describe('europepmc', () => {
  const papers = europepmc.parse(EPMC_FIXTURE)

  it('maps journal records as official articles with Crossref bibtex provenance', () => {
    expect(papers[0]).toMatchObject({
      sourceId: 'europepmc',
      title: 'Machine learning for electricity demand forecasting',
      authors: ['Lovelace A', 'Babbage C', 'Noether E'],
      year: 2022,
      venue: 'Energy Systems J',
      official: true,
      bibType: 'article',
      bibtexSource: 'crossref',
      bibtexRef: '10.1000/jrnl.2022.7',
      url: 'https://doi.org/10.1000/jrnl.2022.7',
    })
  })

  it('marks PPR records as preprints', () => {
    expect(papers[1]).toMatchObject({ venue: 'preprint', official: false, bibType: 'misc' })
  })

  it('keeps DOI-less records with empty bibtexRef and a Europe PMC url', () => {
    expect(papers[2]).toMatchObject({
      bibtexRef: '',
      url: 'https://europepmc.org/abstract/MED/99887766',
    })
  })

  it('skips records without a title', () => {
    expect(papers).toHaveLength(3)
  })
})
