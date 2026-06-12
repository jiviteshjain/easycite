import { mergeResults } from '../core/merge'
import type { MergedResult, Paper, SearchResponse, SourceId } from '../core/types'

export interface SearchUpdate {
  results: MergedResult[]
  /** Sources still in flight for the current query. */
  pendingSources: SourceId[]
  errors: Partial<Record<SourceId, string>>
}

const SOURCE_ORDER: SourceId[] = ['dblp', 'openreview', 'arxiv']

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

  constructor(
    private readonly onUpdate: (update: SearchUpdate) => void,
    private sources: SourceId[],
    private preferOfficial: boolean,
    private readonly debounceMs: number
  ) {}

  setSources(sources: SourceId[], preferOfficial: boolean): void {
    this.sources = sources
    this.preferOfficial = preferOfficial
  }

  query(text: string): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    const trimmed = text.trim()
    if (trimmed.length < 3) {
      this.seq++
      this.papersBySource.clear()
      this.errors = {}
      this.pending.clear()
      this.emit()
      return
    }
    this.timer = setTimeout(() => this.run(trimmed), this.debounceMs)
  }

  /** Skip the debounce (e.g. on Enter or when seeding the initial query). */
  queryNow(text: string): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    const trimmed = text.trim()
    if (trimmed.length >= 3) this.run(trimmed)
  }

  private run(query: string): void {
    const seq = ++this.seq
    this.papersBySource.clear()
    this.errors = {}
    this.pending = new Set(this.sources)
    this.emit()

    for (const source of this.sources) {
      chrome.runtime
        .sendMessage({ kind: 'search', source, query, seq })
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
    const papers = SOURCE_ORDER.flatMap((s) => this.papersBySource.get(s) ?? [])
    this.onUpdate({
      results: mergeResults(papers, this.preferOfficial),
      pendingSources: [...this.pending],
      errors: this.errors,
    })
  }
}
