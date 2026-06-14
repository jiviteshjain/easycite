import { extractField, parseEntries, stripTex } from './bibtex'
import type { Paper } from './types'

const ARXIV_RE = /arxiv|\bcorr\b/i

function parseAuthors(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/\s+and\s+/i)
    .map((a) => {
      const clean = stripTex(a)
      if (!clean.includes(',')) return clean
      const [last, first] = clean.split(',')
      return `${first?.trim() ?? ''} ${last!.trim()}`.trim()
    })
    .filter(Boolean)
}

/** Turn the entries of a .bib file into Papers from the 'local' pseudo-source. */
export function parseBibPapers(bib: string): Paper[] {
  return parseEntries(bib).flatMap((entry) => {
    const title = stripTex(extractField(entry.text, 'title') ?? '')
    if (!title) return []
    const year = extractField(entry.text, 'year')?.match(/\d{4}/)?.[0]
    let venue = stripTex(
      extractField(entry.text, 'booktitle') ?? extractField(entry.text, 'journal') ?? ''
    )
    const eprintHost =
      extractField(entry.text, 'archiveprefix') ?? extractField(entry.text, 'eprinttype') ?? ''
    if (!venue && ARXIV_RE.test(eprintHost)) venue = 'arXiv'
    const doi = extractField(entry.text, 'doi')
    const eprint = extractField(entry.text, 'eprint')
    // howpublished often wraps a URL: `{\url{https://...}}`, `Online at \url{...}`,
    // or just the bare URL — pull the first http(s) link.
    const howpublished = extractField(entry.text, 'howpublished')?.match(/https?:\/\/[^\s}]+/)?.[0]
    const url =
      extractField(entry.text, 'url') ??
      (doi ? `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}` : undefined) ??
      (eprint && ARXIV_RE.test(eprintHost) ? `https://arxiv.org/abs/${eprint}` : undefined) ??
      howpublished
    return [
      {
        sourceId: 'local' as const,
        id: entry.key,
        title,
        authors: parseAuthors(extractField(entry.text, 'author')),
        year: year ? parseInt(year, 10) : undefined,
        venue: venue || 'unknown venue',
        official: Boolean(venue) && !ARXIV_RE.test(venue),
        bibtexSource: 'local' as const,
        bibtexRef: entry.key,
        url,
      },
    ]
  })
}

const MAX_LOCAL_MATCHES = 5

/** Typeahead match over existing entries: every query token must appear somewhere. */
export function matchLocalPapers(papers: Paper[], query: string): Paper[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.length === 0) return []
  return papers
    .filter((p) => {
      const hay =
        `${p.bibtexRef} ${p.title} ${p.authors.join(' ')} ${p.year ?? ''} ${p.venue}`.toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
    .slice(0, MAX_LOCAL_MATCHES)
}
