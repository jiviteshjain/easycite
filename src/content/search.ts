import { matchLocalPapers } from '../core/local'
import { mergeResults, rerankByQuery } from '../core/merge'
import type { MergedResult, Paper, SearchResponse, SourceId } from '../core/types'

export interface SearchUpdate {
  results: MergedResult[]
  /** Sources still in flight for the current query. */
  pendingSources: SourceId[]
  errors: Partial<Record<SourceId, string>>
}

const SOURCE_ORDER: SourceId[] = ['dblp', 'openreview', 'arxiv', 'crossref', 'europepmc']

/**
 * Typeahead controller: debounces queries, fans out to all enabled sources in
 * parallel, re-merges incrementally as each source responds, and drops stale
 * responses by sequence number.
 */
export class SearchController {
  private seq = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private papersBySource = new Map<SourceId, Paper[]>()
  private errors: Partial<Record<SourceId, string>> = {}
  private pending = new Set<SourceId>()
  private localPapers: Paper[] = []
  private currentQuery = ''

  constructor(
    private readonly onUpdate: (update: SearchUpdate) => void,
    private sources: SourceId[],
    private preferOfficial: boolean,
    private readonly debounceMs: number,
    private arxivCategories?: string[]
  ) {}

  /** Sources minus arXiv when its category selection is empty (= disabled). */
  private effective(sources: SourceId[]): SourceId[] {
    return sources.filter((s) => !(s === 'arxiv' && this.arxivCategories?.length === 0))
  }

  private dropSource(source: SourceId): void {
    this.papersBySource.delete(source)
    this.pending.delete(source)
    delete this.errors[source]
  }

  setArxivCategories(categories: string[]): void {
    this.arxivCategories = categories
    if (!this.currentQuery || !this.sources.includes('arxiv')) return
    // A topic change invalidates current arXiv results; refetch under the new filter.
    this.dropSource('arxiv')
    this.fanOut(this.effective(['arxiv']), this.currentQuery, this.seq)
    this.emit()
  }

  /** Mid-search toggles apply live: removed sources' results disappear, newly
   *  enabled ones are queried immediately (response-cached upstream, so cheap). */
  setSources(sources: SourceId[], preferOfficial: boolean): void {
    const prev = this.sources
    this.sources = sources
    this.preferOfficial = preferOfficial
    if (!this.currentQuery) return
    for (const s of prev) if (!sources.includes(s)) this.dropSource(s)
    this.fanOut(this.effective(sources.filter((s) => !prev.includes(s))), this.currentQuery, this.seq)
    this.emit()
  }

  /** Entries already in the project's .bib — matched locally, pinned above remote results. */
  setLocalPapers(papers: Paper[]): void {
    this.localPapers = papers
    this.emit()
  }

  /**
   * Track the query and handle the local-only cases (remote sources need >= 3
   * chars; local entries filter on any input and all show on none).
   * Returns true when a remote search should follow.
   */
  private setQuery(trimmed: string): boolean {
    this.currentQuery = trimmed
    if (trimmed.length >= 3) return true
    this.seq++
    this.papersBySource.clear()
    this.errors = {}
    this.pending.clear()
    this.emit()
    return false
  }

  query(text: string): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    const trimmed = text.trim()
    if (!this.setQuery(trimmed)) return
    // Local entries filter instantly; the remote fan-out waits for the debounce.
    this.emit()
    this.timer = setTimeout(() => this.run(trimmed), this.debounceMs)
  }

  /** Skip the debounce (e.g. on Enter or when seeding the initial query). */
  queryNow(text: string): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    const trimmed = text.trim()
    if (this.setQuery(trimmed)) this.run(trimmed)
  }

  private run(query: string): void {
    const seq = ++this.seq
    this.currentQuery = query
    this.papersBySource.clear()
    this.errors = {}
    this.pending.clear()
    const sources = this.effective(this.sources)
    this.fanOut(sources, query, seq)
    this.emit()
  }

  private fanOut(sources: SourceId[], query: string, seq: number): void {
    for (const source of sources) {
      this.pending.add(source)
      chrome.runtime
        .sendMessage({ kind: 'search', source, query, seq, arxivCategories: this.arxivCategories })
        .then((res: SearchResponse) => {
          if (res.seq !== this.seq) return
          this.pending.delete(source)
          if (res.error) this.errors[source] = res.error
          else this.papersBySource.set(source, res.papers)
          this.emit()
        })
        .catch((err) => {
          if (seq !== this.seq) return
          this.pending.delete(source)
          this.errors[source] = err instanceof Error ? err.message : String(err)
          this.emit()
        })
    }
  }

  private emit(): void {
    // No query at all -> browse the whole bibliography with the arrow keys.
    const local = this.currentQuery
      ? matchLocalPapers(this.localPapers, this.currentQuery)
      : this.localPapers
    const papers = [...local, ...SOURCE_ORDER.flatMap((s) => this.papersBySource.get(s) ?? [])]
    const merged = mergeResults(papers, this.preferOfficial)
    this.onUpdate({
      // Local matches already filter on the query; re-rank only the remote
      // groups by title/author match, then put local matches back on top.
      results: [
        ...merged.filter((r) => r.primary.bibtexSource === 'local'),
        ...rerankByQuery(
          merged.filter((r) => r.primary.bibtexSource !== 'local'),
          this.currentQuery
        ),
      ],
      pendingSources: [...this.pending],
      errors: this.errors,
    })
  }
}
