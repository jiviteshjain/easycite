import type { Paper, SourceQueryOptions } from '../types'

export const POLITE_POOL = false

export function buildUrl(query: string, _opts?: SourceQueryOptions): string {
  return `https://dblp.org/search/publ/api?q=${encodeURIComponent(query)}&format=json&h=15`
}

interface DblpHit {
  info: {
    title?: string
    authors?: { author: { text: string } | { text: string }[] }
    venue?: string | string[]
    year?: string
    key?: string
    type?: string
    ee?: string | string[]
    url?: string
  }
}

export function parse(json: string): Paper[] {
  const data = JSON.parse(json)
  const hits: DblpHit[] = data?.result?.hits?.hit ?? []
  return hits.flatMap((hit) => {
    const info = hit.info
    if (!info?.title || !info.key) return []
    const authorField = info.authors?.author
    const authors = (Array.isArray(authorField) ? authorField : authorField ? [authorField] : [])
      .map((a) => a.text.replace(/\s+\d{4}$/, '')) // dblp disambiguation suffixes like "Wei Li 0002"
    const venue = Array.isArray(info.venue) ? info.venue.join(', ') : (info.venue ?? '')
    const isCorr = venue === 'CoRR' || info.type === 'Informal and Other Publications'
    const ees = Array.isArray(info.ee) ? info.ee : info.ee ? [info.ee] : []
    const matchEe = (re: RegExp) => ees.map((ee) => ee.match(re)?.[1]).find(Boolean)
    const aclId = matchEe(/aclanthology\.org\/([^/]+?)(?:\.pdf)?\/?$/)
    // DBLP links CoRR records as arxiv.org/abs/<id> or doi.org/10.48550/arXiv.<id>
    const arxivId = isCorr
      ? matchEe(/arxiv\.org\/abs\/([0-9.]+v?\d*|[a-z-]+\/\d{7})/i) ??
        matchEe(/10\.48550\/arXiv\.([0-9.]+)/i)
      : undefined

    const paper: Paper = {
      sourceId: 'dblp',
      id: info.key,
      title: info.title.replace(/\.$/, ''),
      authors,
      year: info.year ? parseInt(info.year, 10) : undefined,
      venue: isCorr ? 'arXiv' : venue,
      official: !isCorr,
      bibtexSource: aclId ? 'acl' : isCorr && arxivId ? 'arxiv' : 'dblp',
      bibtexRef: aclId ?? (isCorr && arxivId ? arxivId : info.key),
      url: ees[0] ?? info.url,
    }
    return [paper]
  })
}

export function bibtexUrl(dblpKey: string): string {
  return `https://dblp.org/rec/${dblpKey}.bib`
}
