export type SourceId = 'dblp' | 'openreview' | 'arxiv'

export type Provenance = 'acl' | 'dblp' | 'openreview' | 'arxiv'

export interface Paper {
  /** Stable id within its source (dblp key, openreview note id, arxiv id, acl id). */
  sourceId: SourceId
  id: string
  title: string
  authors: string[]
  year?: number
  /** Human-readable venue, e.g. "NeurIPS", "ACL", "arXiv", "ICLR 2024". */
  venue: string
  /** True if this record is an official published version (not a preprint). */
  official: boolean
  /** Where to fetch the canonical BibTeX from. */
  bibtexSource: Provenance
  /** Param needed to fetch bibtex: acl id, dblp key, arxiv id — or the inline bibtex for openreview. */
  bibtexRef: string
  /** BibTeX already in hand (OpenReview ships it in the search response). */
  inlineBibtex?: string
  url?: string
}

/** One card in the results list: an official version, possibly with a preprint alternate. */
export interface MergedResult {
  primary: Paper
  alternate?: Paper
}

export interface SearchRequest {
  kind: 'search'
  source: SourceId
  query: string
  seq: number
}

export interface SearchResponse {
  source: SourceId
  seq: number
  papers: Paper[]
  error?: string
}

export interface BibtexRequest {
  kind: 'bibtex'
  provenance: Provenance
  ref: string
}

export interface BibtexResponse {
  bibtex?: string
  error?: string
}

export interface OpenTabRequest {
  kind: 'open-tab'
  url: string
}

export type BackgroundRequest = SearchRequest | BibtexRequest | OpenTabRequest
