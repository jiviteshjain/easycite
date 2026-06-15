import css from './overlay.css?inline'
import { ARXIV_GROUP_IDS, ARXIV_GROUP_LABELS } from '../core/sources/arxiv'
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
  onSetArxivCategories(groups: string[]): void
}

const SOURCE_LABELS: Record<SourceId | 'local', string> = {
  dblp: 'DBLP',
  openreview: 'OpenReview',
  arxiv: 'arXiv',
  crossref: 'Crossref',
  europepmc: 'Europe PMC',
  local: 'your bibliography',
}

const ALL_SOURCES: SourceId[] = ['dblp', 'openreview', 'arxiv', 'crossref', 'europepmc']

const PROVENANCE_LABELS: Record<Provenance, string> = {
  acl: 'ACL Anthology',
  dblp: 'DBLP',
  openreview: 'OpenReview',
  arxiv: 'arXiv',
  crossref: 'Crossref',
  local: 'your bibliography',
}

const ERROR_STATUS_TTL_MS = 6000

/** Fixed colors for big venues; matches the short name and the canonical long
 *  form (BibTeX from Crossref/Europe PMC often carries the expanded title). */
const VENUE_CLASSES: [RegExp, string][] = [
  [
    /\bacl\b|emnlp|naacl|eacl|conll|tacl|aacl|computational linguistics|empirical methods in natural language|computational natural language learning|natural language processing/i,
    'v-acl',
  ],
  [/arxiv|\bcorr\b/i, 'v-arxiv'],
  [/neurips|\bnips\b|neural information processing/i, 'v-neurips'],
  [/\bicml\b|international conference on machine learning/i, 'v-icml'],
  [/\biclr\b|international conference on learning representations/i, 'v-iclr'],
  [/\bcolm\b|conference on language modeling|conference on language models/i, 'v-colm'],
  [
    /cvpr|iccv|eccv|wacv|computer vision and pattern recognition|international conference on computer vision|european conference on computer vision|applications of computer vision/i,
    'v-cv',
  ],
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
  private chipsEl!: HTMLDivElement
  private chipEls = new Map<SourceId, HTMLButtonElement>()
  private bibBtn!: HTMLButtonElement
  private pickerEl: HTMLDivElement | null = null
  private pickerKind: 'bib' | 'cat' | null = null

  private results: MergedResult[] = []
  private selected = 0
  private animToken = 0
  private statusTimer: ReturnType<typeof setTimeout> | undefined
  private enabledSources: SourceId[] = []
  private bibFiles: string[] = []
  private currentBibFile: string | undefined
  private arxivCategories: string[] = []
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
    // Clicking anywhere outside an open picker closes it (the toggle buttons
    // handle themselves).
    this.panel.addEventListener(
      'mousedown',
      (e) => {
        if (!this.pickerEl) return
        const target = e.target as HTMLElement
        if (this.pickerEl.contains(target) || target.closest('.caret, .bib-file')) return
        this.closePicker()
      },
      true
    )

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
    // Hints + status share a fixed slot with overflow:hidden; status slides up
    // from below to replace the hints, the hints slide back when it clears.
    const messageSlot = el('div', 'message-slot')
    this.statusEl = el('div', 'status')
    messageSlot.append(hints, this.statusEl)
    footer.appendChild(messageSlot)

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
    this.chipEls.clear()
    this.chipsEl.replaceChildren(
      ...ALL_SOURCES.map((source) => {
        const chip = document.createElement('button')
        chip.className = `chip${this.isEffectivelyOn(source) ? ' on' : ''}`
        chip.textContent = SOURCE_LABELS[source]
        chip.title = `Toggle ${SOURCE_LABELS[source]} for this project`
        chip.addEventListener('click', () => this.onChipClick(source))
        this.chipEls.set(source, chip)
        if (source !== 'arxiv') return chip
        // arXiv gets a caret opening the per-project topic picker.
        const group = el('span', 'chip-group')
        const caret = document.createElement('button')
        caret.className = `chip caret${this.isEffectivelyOn(source) ? ' on' : ''}`
        caret.textContent = '▾'
        caret.title = 'arXiv topics for this project'
        caret.addEventListener('click', () => this.toggleCatPicker())
        group.append(chip, caret)
        return group
      })
    )
    this.renderSourceStatus([], {})
  }

  /** UI-only: arXiv looks off when its topic selection is empty (source still
   *  enabled in storage, but the controller skips it). */
  private isEffectivelyOn(source: SourceId): boolean {
    if (!this.enabledSources.includes(source)) return false
    if (source === 'arxiv' && this.arxivCategories.length === 0) return false
    return true
  }

  /** Click on a ghost-disabled arXiv chip opens its topic picker so the user
   *  can re-enable, instead of producing no visible change. */
  private onChipClick(source: SourceId): void {
    if (source === 'arxiv' && this.enabledSources.includes('arxiv') && this.arxivCategories.length === 0) {
      this.toggleCatPicker()
      return
    }
    this.cb.onToggleSource(source)
  }

  setArxivCategories(groups: string[]): void {
    this.arxivCategories = groups
    // Refresh chip styling if arXiv toggled across the ghost-disabled threshold.
    const chip = this.chipEls.get('arxiv')
    if (chip) {
      chip.classList.toggle('on', this.isEffectivelyOn('arxiv'))
      const caret = chip.parentElement?.querySelector('.caret')
      caret?.classList.toggle('on', this.isEffectivelyOn('arxiv'))
    }
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
    // The slide animation is in CSS via the .showing class on the slot;
    // text content stays present so the slot's height never collapses.
    const slot = this.statusEl.parentElement!
    if (text === null) {
      slot.classList.remove('showing', 'error')
    } else {
      this.statusEl.textContent = text
      slot.classList.add('showing')
      slot.classList.toggle('error', isError)
    }
  }

  update(update: SearchUpdate): void {
    this.hasSearched = true
    this.results = update.results
    this.selected = Math.min(this.selected, Math.max(0, this.results.length - 1))
    this.renderSourceStatus(update.pendingSources, update.errors)
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

  /** Search status shown on the chips: pulsing border in flight, red on error. */
  private renderSourceStatus(pending: SourceId[], errors: Partial<Record<SourceId, string>>): void {
    for (const [source, chip] of this.chipEls) {
      chip.classList.toggle('pending', pending.includes(source))
      chip.classList.toggle('error', !pending.includes(source) && Boolean(errors[source]))
      chip.title = errors[source] ?? `Toggle ${SOURCE_LABELS[source]} for this project`
    }
  }

  /** Per-project arXiv topic picker, opened from the caret on the arXiv chip. */
  private toggleCatPicker(): void {
    const wasOpen = this.pickerKind === 'cat'
    this.closePicker()
    if (wasOpen) return
    const picker = el('div', 'bib-picker cat-picker')
    picker.addEventListener('mousedown', (e) => e.preventDefault())
    const hint = el('div', 'cat-hint')
    hint.textContent = 'arXiv topics for this project'
    picker.appendChild(hint)
    for (const group of ARXIV_GROUP_IDS) {
      const label = document.createElement('label')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = this.arxivCategories.includes(group)
      box.addEventListener('change', () => {
        const next = box.checked
          ? [...this.arxivCategories, group]
          : this.arxivCategories.filter((g) => g !== group)
        this.arxivCategories = next
        this.cb.onSetArxivCategories(next)
      })
      label.append(box, document.createTextNode(ARXIV_GROUP_LABELS[group] ?? group))
      picker.appendChild(label)
    }
    this.panel.appendChild(picker)
    // Anchor under the caret that opened it, clamped to the panel.
    const caret = this.chipsEl.querySelector('.caret') as HTMLElement | null
    if (caret) {
      const panelRect = this.panel.getBoundingClientRect()
      const caretRect = caret.getBoundingClientRect()
      const left = Math.max(
        12,
        Math.min(caretRect.left - panelRect.left, panelRect.width - picker.offsetWidth - 12)
      )
      picker.style.left = `${left}px`
    }
    this.pickerEl = picker
    this.pickerKind = 'cat'
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
    const wasOpen = this.pickerKind === 'bib'
    this.closePicker()
    if (wasOpen) return
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
    this.pickerKind = 'bib'
  }

  private closePicker(): void {
    this.pickerEl?.remove()
    this.pickerEl = null
    this.pickerKind = null
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
  showBibToast(key: string, file: string, entry: string, origin?: string): number {
    const toast = el('div', 'toast bib')
    const header = el('div', 'bib-toast-header')
    const code = document.createElement('code')
    code.textContent = `@${key}`
    header.append(code, document.createTextNode(` → ${file}`))
    if (origin) {
      const from = el('span', 'bib-origin')
      from.textContent = origin
      header.appendChild(from)
    }
    header.appendChild(undoHintEl())
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
