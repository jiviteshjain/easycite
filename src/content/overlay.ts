import css from './overlay.css?inline'
import type { MergedResult, Provenance, SourceId } from '../core/types'
import type { SearchUpdate } from './search'

export interface SelectOptions {
  alternate: boolean
  keepOpen: boolean
}

export interface OverlayCallbacks {
  onQueryChange(text: string): void
  onSubmit(text: string): void
  onSelect(result: MergedResult, opts: SelectOptions): void
  onOpenPaper(result: MergedResult): void
  onClose(): void
  onToggleSource(source: SourceId): void
  onPickBibFile(file: string): void
}

const SOURCE_LABELS: Record<SourceId | 'local', string> = {
  dblp: 'DBLP',
  openreview: 'OpenReview',
  arxiv: 'arXiv',
  local: 'your bibliography',
}

const ALL_SOURCES: SourceId[] = ['dblp', 'openreview', 'arxiv']

const PROVENANCE_LABELS: Record<Provenance, string> = {
  acl: 'ACL Anthology',
  dblp: 'DBLP',
  openreview: 'OpenReview',
  arxiv: 'arXiv',
  local: 'your bibliography',
}

const ERROR_STATUS_TTL_MS = 4000

/** Fixed colors for big venues (matched against the venue string); others fall back to accent blue. */
const VENUE_CLASSES: [RegExp, string][] = [
  [/\bacl\b|emnlp|naacl|eacl|conll|tacl|aacl/i, 'v-acl'],
  [/arxiv|\bcorr\b/i, 'v-arxiv'],
  [/neurips|\bnips\b/i, 'v-neurips'],
  [/\bicml\b/i, 'v-icml'],
  [/\biclr\b/i, 'v-iclr'],
  [/cvpr|iccv|eccv|wacv/i, 'v-cv'],
]

function venueClass(venue: string): string {
  return VENUE_CLASSES.find(([re]) => re.test(venue))?.[1] ?? ''
}

export class Overlay {
  private host: HTMLDivElement
  private root: ShadowRoot
  private backdrop!: HTMLDivElement
  private panel!: HTMLDivElement
  private input!: HTMLInputElement
  private resultsEl!: HTMLDivElement
  private statusEl!: HTMLDivElement
  private dotsEl!: HTMLDivElement
  private chipsEl!: HTMLDivElement
  private bibBtn!: HTMLButtonElement
  private pickerEl: HTMLDivElement | null = null

  private results: MergedResult[] = []
  private selected = 0
  private animToken = 0
  private statusTimer: ReturnType<typeof setTimeout> | undefined
  private enabledSources: SourceId[] = []
  private bibFiles: string[] = []
  private currentBibFile: string | undefined
  private hasSearched = false

  constructor(private readonly cb: OverlayCallbacks) {
    this.host = document.createElement('div')
    this.root = this.host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = css
    this.root.appendChild(style)
    this.build()
  }

  private build(): void {
    this.backdrop = el('div', 'backdrop')
    this.backdrop.addEventListener('mousedown', () => this.cb.onClose())

    this.panel = el('div', 'panel')
    this.panel.addEventListener('keydown', (e) => this.onKeydown(e))

    const searchRow = el('div', 'search-row')
    searchRow.innerHTML = `
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>
      </svg>`
    this.input = document.createElement('input')
    this.input.className = 'query'
    this.input.placeholder = 'Search title, authors, year…'
    this.input.addEventListener('input', () => this.cb.onQueryChange(this.input.value))
    searchRow.appendChild(this.input)
    this.dotsEl = el('div', 'source-dots')
    searchRow.appendChild(this.dotsEl)
    // Anchored under the search row, absolutely positioned so showing it
    // doesn't shift the result list.
    this.statusEl = el('div', 'status')
    this.statusEl.style.display = 'none'
    searchRow.appendChild(this.statusEl)

    this.resultsEl = el('div', 'results')
    // Keep focus in the search input on clicks so arrow keys keep moving the
    // selection instead of natively scrolling the list.
    this.resultsEl.addEventListener('mousedown', (e) => e.preventDefault())

    const footer = el('div', 'footer')
    this.bibBtn = document.createElement('button')
    this.bibBtn.className = 'bib-file'
    this.bibBtn.addEventListener('click', () => this.togglePicker())
    footer.appendChild(this.bibBtn)
    this.chipsEl = el('div', 'chips')
    footer.appendChild(this.chipsEl)
    footer.appendChild(el('div', 'spacer'))
    const hints = el('div', 'hints')
    hints.innerHTML = `
      <span><kbd>↑↓</kbd>pick</span>
      <span><kbd>⏎</kbd>insert</span>
      <span><kbd>⌥⏎</kbd>alt ver.</span>
      <span><kbd>⌘⏎</kbd>multi</span>
      <span><kbd>⇧⏎</kbd>open</span>
      <span><kbd>esc</kbd>close</span>`
    footer.appendChild(hints)

    this.panel.append(searchRow, this.resultsEl, footer)
    this.root.append(this.backdrop, this.panel)
  }

  open(seedQuery: string): void {
    if (!this.host.isConnected) document.body.appendChild(this.host)
    // Toggle panel/backdrop only — toasts share this shadow root and must
    // survive the overlay closing.
    this.backdrop.style.display = ''
    this.panel.style.display = ''
    this.hasSearched = false
    this.input.value = seedQuery
    this.input.select()
    this.renderResults()
    this.input.focus()
  }

  close(): void {
    this.closePicker()
    this.backdrop.style.display = 'none'
    this.panel.style.display = 'none'
    this.results = []
    this.selected = 0
    this.renderResults()
  }

  get isOpen(): boolean {
    return this.host.isConnected && this.panel.style.display !== 'none'
  }

  setSources(enabled: SourceId[]): void {
    this.enabledSources = enabled
    this.chipsEl.replaceChildren(
      ...ALL_SOURCES.map((source) => {
        const chip = document.createElement('button')
        chip.className = `chip${enabled.includes(source) ? ' on' : ''}`
        chip.textContent = SOURCE_LABELS[source]
        chip.title = `Toggle ${SOURCE_LABELS[source]} for this project`
        chip.addEventListener('click', () => this.cb.onToggleSource(source))
        return chip
      })
    )
    this.renderDots([], {})
  }

  setBibFiles(files: string[], current: string | undefined): void {
    this.bibFiles = files
    this.currentBibFile = current
    this.bibBtn.textContent = `⤷ ${current ?? 'choose .bib file'}`
    this.bibBtn.title = 'Bibliography file for this project'
  }

  setStatus(text: string | null, isError = false): void {
    if (this.statusTimer !== undefined) {
      clearTimeout(this.statusTimer)
      this.statusTimer = undefined
    }
    if (text === null) {
      this.statusEl.style.display = 'none'
    } else {
      this.statusEl.style.display = ''
      this.statusEl.textContent = text
      this.statusEl.className = `status${isError ? ' error' : ''}`
    }
  }

  update(update: SearchUpdate): void {
    this.hasSearched = true
    this.results = update.results
    this.selected = Math.min(this.selected, Math.max(0, this.results.length - 1))
    this.renderDots(update.pendingSources, update.errors)
    const errors = Object.entries(update.errors)
    if (errors.length > 0) {
      // Per-source failures are harmless (the other sources still answered):
      // surface them briefly, then get out of the way.
      this.setStatus(
        errors.map(([s, e]) => `${SOURCE_LABELS[s as SourceId]}: ${e}`).join(' · '),
        true
      )
      this.statusTimer = setTimeout(() => this.setStatus(null), ERROR_STATUS_TTL_MS)
    } else {
      this.setStatus(null)
    }
    this.renderResults(update.pendingSources.length > 0)
  }

  private renderDots(pending: SourceId[], errors: Partial<Record<SourceId, string>>): void {
    this.dotsEl.replaceChildren(
      ...this.enabledSources.map((source) => {
        const dot = el('div', 'dot')
        if (pending.includes(source)) dot.classList.add('pending')
        else if (errors[source]) dot.classList.add('error')
        dot.title = SOURCE_LABELS[source]
        return dot
      })
    )
  }

  private renderResults(searching = false): void {
    if (this.results.length === 0) {
      const empty = el('div', 'empty')
      empty.textContent = searching
        ? 'Searching…'
        : this.hasSearched && this.input.value.trim().length >= 3
          ? 'No matches'
          : 'Type to search papers'
      this.resultsEl.replaceChildren(empty)
      return
    }
    this.resultsEl.replaceChildren(
      ...this.results.map((result, i) => {
        const row = el('div', 'row')
        const p = result.primary

        const main = el('div', 'row-main')

        // Venue line above the title: colored name + filled (official) / open
        // (preprint) dot, so long venue names don't squeeze the title.
        const venueLine = el('div', `venue ${venueClass(p.venue)}`)
        const vdot = el('span', `vdot${p.official ? '' : ' open'}`)
        const vname = el('span', 'vname')
        const showYear = p.year && !p.venue.includes(String(p.year))
        vname.textContent = [p.venue, showYear ? p.year : undefined].filter(Boolean).join(' ')
        venueLine.append(vdot, vname)
        if (p.bibtexSource === 'local') {
          const badge = el('span', 'inbib')
          badge.textContent = `✓ in ${this.currentBibFile ?? 'bib'}`
          venueLine.appendChild(badge)
        }
        if (result.alternate) {
          const alt = el('span', 'alt-hint')
          alt.textContent = `⌥⏎ ${result.alternate.venue}`
          venueLine.appendChild(alt)
        }

        const title = el('div', 'title')
        title.textContent = p.title
        const meta = el('div', 'meta')
        meta.textContent = p.authors.slice(0, 4).join(', ') + (p.authors.length > 4 ? ' et al.' : '')

        // Full details live in every row, revealed by the .expanded class so
        // selection changes animate instead of rebuilding the DOM.
        const detailsWrap = el('div', 'details-wrap')
        const details = el('div', 'details')
        const fullAuthors =
          p.authors.length > 8
            ? `${p.authors.slice(0, 5).join(', ')} … ${p.authors.slice(-2).join(', ')}`
            : p.authors.join(', ')
        const authorsLine = el('div', 'details-authors')
        authorsLine.textContent = fullAuthors
        const provenanceLine = el('div', 'details-provenance')
        provenanceLine.textContent =
          p.bibtexSource === 'local'
            ? [[p.venue, p.year].filter(Boolean).join(' '), `@${p.bibtexRef}`].join(' · ')
            : [
                [p.venue, p.year].filter(Boolean).join(' '),
                `found via ${SOURCE_LABELS[p.sourceId]}`,
                `BibTeX from ${PROVENANCE_LABELS[p.bibtexSource]}`,
                result.alternate ? `⌥⏎ for ${result.alternate.venue} version` : undefined,
              ]
                .filter(Boolean)
                .join(' · ')
        details.append(authorsLine, provenanceLine)
        detailsWrap.appendChild(details)

        main.append(venueLine, title, meta, detailsWrap)
        row.appendChild(main)

        row.addEventListener('click', (e) => {
          if (e.shiftKey) this.cb.onOpenPaper(result)
          else this.cb.onSelect(result, { alternate: e.altKey, keepOpen: e.metaKey || e.ctrlKey })
        })
        row.addEventListener('mousemove', () => {
          if (this.selected !== i) {
            this.selected = i
            this.applySelection()
          }
        })
        return row
      })
    )
    this.applySelection(false, false)
  }

  /**
   * Toggle selected/expanded classes in place, animating each row between its
   * real measured heights (FLIP). max-height tricks animate toward a cap, not
   * the actual height, which desynchronizes collapse and expand and makes the
   * list bounce; interpolating measured pixels keeps the motion symmetric.
   */
  private applySelection(scroll = true, animate = true): void {
    const rows = [...this.resultsEl.querySelectorAll('.row')] as HTMLElement[]
    const before = animate ? rows.map((row) => row.offsetHeight) : []
    rows.forEach((row, i) => {
      row.classList.toggle('selected', i === this.selected)
      row.classList.toggle('expanded', i === this.selected)
    })
    if (animate) {
      const token = String(++this.animToken)
      rows.forEach((row, i) => {
        row.style.height = ''
        const target = row.offsetHeight
        if (target === before[i]) return
        row.style.height = `${before[i]}px`
        row.style.overflow = 'hidden'
        void row.offsetHeight // flush so the next assignment transitions
        row.style.height = `${target}px`
        row.dataset.anim = token
        setTimeout(() => {
          if (row.dataset.anim === token) {
            row.style.height = ''
            row.style.overflow = ''
          }
        }, 200)
      })
    }
    if (scroll) {
      rows[this.selected]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (this.pickerEl) this.closePicker()
      else this.cb.onClose()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      this.selected = Math.max(0, Math.min(this.results.length - 1, this.selected + delta))
      this.applySelection()
      return
    }
    if (e.key === 'Enter' && e.target === this.input && this.results.length === 0) {
      e.preventDefault()
      this.cb.onSubmit(this.input.value)
      return
    }
    if (e.key === 'Enter' && this.results.length > 0 && !(e.target as HTMLElement).closest('.chips, .bib-file, .bib-picker')) {
      e.preventDefault()
      const result = this.results[this.selected]
      if (!result) return
      if (e.shiftKey) {
        this.cb.onOpenPaper(result)
      } else {
        this.cb.onSelect(result, { alternate: e.altKey, keepOpen: e.metaKey || e.ctrlKey })
      }
    }
  }

  private togglePicker(): void {
    if (this.pickerEl) {
      this.closePicker()
      return
    }
    const picker = el('div', 'bib-picker')
    picker.addEventListener('mousedown', (e) => e.preventDefault())
    const files = this.bibFiles.length > 0 ? this.bibFiles : []
    if (files.length === 0) {
      const empty = el('div', 'empty')
      empty.textContent = 'No .bib files in this project'
      picker.appendChild(empty)
    }
    for (const file of files) {
      const row = el('div', `row${file === this.currentBibFile ? ' selected' : ''}`)
      const main = el('div', 'row-main')
      const title = el('div', 'title')
      title.textContent = file
      main.appendChild(title)
      row.appendChild(main)
      row.addEventListener('click', () => {
        this.closePicker()
        this.cb.onPickBibFile(file)
      })
      picker.appendChild(row)
    }
    this.panel.appendChild(picker)
    this.pickerEl = picker
  }

  private closePicker(): void {
    this.pickerEl?.remove()
    this.pickerEl = null
  }

  focusInput(): void {
    this.input.focus()
  }

  getQuery(): string {
    return this.input.value
  }

  showToast(
    content: { key?: string; file?: string; text?: string },
    kind: 'ok' | 'warn' | 'error' = 'ok',
    undoHint = false
  ): number {
    const toast = el('div', `toast${kind !== 'ok' ? ` ${kind}` : ''}`)
    if (content.text) {
      if (content.key) {
        const code = document.createElement('code')
        code.textContent = `@${content.key}`
        toast.appendChild(document.createTextNode(`${content.text} `))
        toast.appendChild(code)
      } else {
        toast.textContent = content.text
      }
    } else {
      const code = document.createElement('code')
      code.textContent = `@${content.key}`
      toast.appendChild(code)
      toast.appendChild(document.createTextNode(` → ${content.file}`))
    }
    if (undoHint) toast.appendChild(undoHintEl())
    const ttl = kind === 'ok' && !undoHint ? 2600 : 5000
    this.placeToast(toast, ttl)
    return ttl
  }

  /** Show the BibTeX entry that was just inserted; auto-dismisses. Returns the TTL. */
  showBibToast(key: string, file: string, entry: string): number {
    const toast = el('div', 'toast bib')
    const header = el('div', 'bib-toast-header')
    const code = document.createElement('code')
    code.textContent = `@${key}`
    header.append(code, document.createTextNode(` → ${file}`), undoHintEl())
    const pre = document.createElement('pre')
    pre.textContent = truncateBibPreview(entry)
    toast.append(header, pre)
    this.placeToast(toast, 7000)
    return 7000
  }

  clearToasts(): void {
    for (const t of this.root.querySelectorAll('.toast')) t.remove()
  }

  private placeToast(toast: HTMLDivElement, ttlMs: number): void {
    // Stack above existing toasts (heights vary, so measure them).
    let bottom = 28
    for (const t of this.root.querySelectorAll('.toast')) {
      bottom += (t as HTMLElement).offsetHeight + 10
    }
    toast.style.bottom = `${bottom}px`
    this.root.appendChild(toast)
    setTimeout(() => toast.remove(), ttlMs)
  }
}

const BIB_PREVIEW_MAX_LINE = 160

/** Truncate oversized fields (100s-of-authors lists, inline abstracts). */
function truncateBibPreview(entry: string): string {
  return entry
    .split('\n')
    .map((line) => {
      if (line.length <= BIB_PREVIEW_MAX_LINE) return line
      const field = line.match(/^\s*\w+\s*=/)?.[0] ?? ''
      return `${line.slice(0, BIB_PREVIEW_MAX_LINE)}…${field ? '},' : ''}`
    })
    .join('\n')
}

function el<K extends 'div' | 'span'>(tag: K, className: string): HTMLDivElement {
  const node = document.createElement(tag)
  node.className = className
  return node as HTMLDivElement
}

function undoHintEl(): HTMLSpanElement {
  const span = el('span', 'undo-hint')
  span.innerHTML = '<kbd>⌘⇧Z</kbd> undo'
  return span
}
