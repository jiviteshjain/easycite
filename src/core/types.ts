export type SourceId = 'dblp' | 'openreview' | 'arxiv' | 'crossref' | 'europepmc'

/** Where the BibTeX comes from; 'local' = already in the project's .bib, nothing to fetch.
 *  'crossref' fetches by DOI — also used by europepmc results (their DOIs are Crossref-registered). */
export type Provenance = 'acl' | 'dblp' | 'openreview' | 'arxiv' | 'crossref' | 'local'

export interface Paper {
  /** Stable id within its source (dblp key, openreview note id, arxiv id, acl id). */
  sourceId: SourceId | 'local'
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
  /** Param needed to fetch bibtex: acl id, dblp key, arxiv id — or the existing key for 'local'. */
  bibtexRef: string
  /** BibTeX already in hand (OpenReview ships it in the search response). */
  inlineBibtex?: string
  /** Entry type hint for synthesized BibTeX (defaults to inproceedings/misc). */
  bibType?: 'article' | 'inproceedings' | 'misc'
  url?: string
}

/** One card in the results list: an official version, possibly with a preprint alternate. */
export interface MergedResult {
  primary: Paper
  alternate?: Paper
}

/** Per-query knobs the controller passes through to every source's buildUrl. */
export interface SourceQueryOptions {
  /** Top-level arXiv archive groups (only the arxiv source uses this). */
  arxivCategories?: string[]
  /** Contact for sources that declare POLITE_POOL = true (Crossref's "mailto"). */
  politeEmail?: string
}

export interface SearchRequest extends SourceQueryOptions {
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
