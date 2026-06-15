import type { Paper, SourceQueryOptions } from '../types'

export const POLITE_POOL = false

export function buildUrl(query: string, _opts?: SourceQueryOptions): string {
  return (
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search` +
    `?query=${encodeURIComponent(query)}&format=json&pageSize=10`
  )
}

interface EpmcResult {
  id?: string
  source?: string
  doi?: string
  title?: string
  authorString?: string
  journalTitle?: string
  pubYear?: string
}

export function parse(json: string): Paper[] {
  const data = JSON.parse(json)
  const results: EpmcResult[] = data?.resultList?.result ?? []
  return results.flatMap((r) => {
    const title = r.title?.replace(/\.$/, '').trim()
    if (!title || !r.id) return []
    // authorString is "Smith J, Doe AB, Lee K." — names keep their initials.
    const authors = (r.authorString ?? '')
      .replace(/\.$/, '')
      .split(/,\s*/)
      .map((a) => a.trim())
      .filter(Boolean)
    const isPreprint = r.source === 'PPR'
    const paper: Paper = {
      sourceId: 'europepmc',
      id: `${r.source ?? 'MED'}:${r.id}`,
      title,
      authors,
      year: r.pubYear ? parseInt(r.pubYear, 10) : undefined,
      venue: r.journalTitle ?? (isPreprint ? 'preprint' : 'unknown venue'),
      official: !isPreprint && Boolean(r.journalTitle),
      bibType: !isPreprint && r.journalTitle ? 'article' : 'misc',
      // Europe PMC has no BibTeX export; DOIs are Crossref-registered, so fetch
      // there. No DOI -> bibtexRef '' -> entry synthesized from this metadata.
      bibtexSource: 'crossref',
      bibtexRef: r.doi ?? '',
      url: r.doi
        ? `https://doi.org/${r.doi}`
        : `https://europepmc.org/abstract/${r.source ?? 'MED'}/${r.id}`,
    }
    return [paper]
  })
}
