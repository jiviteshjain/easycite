import type { Paper, SourceQueryOptions } from '../types'

/** Declared so consumers (settings UI, controller) can list polite-pool sources. */
export const POLITE_POOL = true

// Crossref is the broad, all-fields fallback source: keep it to a few rows so
// same-titled works from other fields don't crowd the specialist sources.
const ROWS = 5

/** Record types that are never citable papers. */
const SKIP_TYPES = new Set(['dataset', 'component', 'peer-review', 'journal-issue', 'grant'])

export function buildUrl(query: string, opts?: SourceQueryOptions): string {
  const select = 'DOI,title,author,container-title,issued,type,URL'
  // mailto opts the request into Crossref's "polite pool" (better rate limits
  // and stability). Without one we hit the shared/throttled pool.
  const mailto = opts?.politeEmail ? `&mailto=${encodeURIComponent(opts.politeEmail)}` : ''
  return (
    `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}` +
    `&rows=${ROWS}&select=${select}${mailto}`
  )
}

interface CrossrefItem {
  DOI?: string
  type?: string
  title?: string[]
  author?: { given?: string; family?: string }[]
  'container-title'?: string[]
  issued?: { 'date-parts'?: (number | null)[][] }
  URL?: string
}

export function parse(json: string): Paper[] {
  const data = JSON.parse(json)
  const items: CrossrefItem[] = data?.message?.items ?? []
  return items.flatMap((item) => {
    const title = item.title?.[0]?.replace(/\s+/g, ' ').trim()
    if (!title || !item.DOI || SKIP_TYPES.has(item.type ?? '')) return []
    const authors = (item.author ?? [])
      .map((a) => [a.given, a.family].filter(Boolean).join(' '))
      .filter(Boolean)
    const year = item.issued?.['date-parts']?.[0]?.[0] ?? undefined
    const venue = item['container-title']?.[0] ?? ''
    // posted-content = preprint servers; venue-less records are unverifiable.
    const official = item.type !== 'posted-content' && venue !== ''
    const paper: Paper = {
      sourceId: 'crossref',
      id: item.DOI,
      title,
      authors,
      year: typeof year === 'number' ? year : undefined,
      venue: venue || (item.type === 'posted-content' ? 'preprint' : 'unknown venue'),
      official,
      bibType:
        item.type === 'journal-article'
          ? 'article'
          : item.type === 'proceedings-article'
            ? 'inproceedings'
            : 'misc',
      bibtexSource: 'crossref',
      bibtexRef: item.DOI,
      url: item.URL ?? `https://doi.org/${item.DOI}`,
    }
    return [paper]
  })
}

export function bibtexUrl(doi: string): string {
  return `https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/x-bibtex`
}
