import * as dblp from './core/sources/dblp'
import * as arxiv from './core/sources/arxiv'
import * as openreview from './core/sources/openreview'
import type {
  BackgroundRequest,
  BibtexResponse,
  Paper,
  Provenance,
  SearchResponse,
  SourceId,
} from './core/types'

const SEARCH_TIMEOUT_MS = 3000
const CACHE_MAX = 200

const cache = new Map<string, string>()

function cachePut(key: string, value: string): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

async function fetchText(url: string, timeoutMs = SEARCH_TIMEOUT_MS): Promise<string> {
  const cached = cache.get(url)
  if (cached !== undefined) return cached
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw new Error('timed out')
    throw err
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
  const text = await res.text()
  cachePut(url, text)
  return text
}

const SOURCES: Record<SourceId, { buildUrl(q: string): string; parse(body: string): Paper[] }> = {
  dblp,
  arxiv,
  openreview,
}

async function handleSearch(source: SourceId, query: string, seq: number): Promise<SearchResponse> {
  try {
    const impl = SOURCES[source]
    const body = await fetchText(impl.buildUrl(query))
    return { source, seq, papers: impl.parse(body) }
  } catch (err) {
    return { source, seq, papers: [], error: err instanceof Error ? err.message : String(err) }
  }
}

function bibtexUrl(provenance: Provenance, ref: string): string {
  switch (provenance) {
    case 'acl':
      return `https://aclanthology.org/${ref}.bib`
    case 'dblp':
      return dblp.bibtexUrl(ref)
    case 'arxiv':
      return arxiv.bibtexUrl(ref)
    case 'openreview':
      throw new Error('OpenReview bibtex is inline; nothing to fetch')
    case 'local':
      throw new Error('Local entries are already in the .bib; nothing to fetch')
  }
}

async function handleBibtex(provenance: Provenance, ref: string): Promise<BibtexResponse> {
  try {
    const bibtex = await fetchText(bibtexUrl(provenance, ref), 6000)
    if (!bibtex.trim().startsWith('@')) throw new Error('Response is not BibTeX')
    return { bibtex: bibtex.trim() }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
  if (msg.kind === 'search') {
    handleSearch(msg.source, msg.query, msg.seq).then(sendResponse)
    return true
  }
  if (msg.kind === 'bibtex') {
    handleBibtex(msg.provenance, msg.ref).then(sendResponse)
    return true
  }
  if (msg.kind === 'open-tab') {
    // Opened from here (not the page) so it's always a tab — in-page opens
    // inherit the physically-held shift key and become a popup window.
    void chrome.tabs.create({ url: msg.url })
    return false
  }
  return false
})

chrome.commands.onCommand.addListener(async (command, tab) => {
  console.log('[EasyCite] command received:', command, 'tab:', tab?.id)
  if (command !== 'open-easycite') return
  let tabId = tab?.id
  // The callback's tab can carry id -1 (TAB_ID_NONE); resolve the active tab instead.
  if (tabId === undefined || tabId < 0) {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    tabId = active?.id
  }
  if (tabId !== undefined && tabId >= 0) {
    chrome.tabs.sendMessage(tabId, { kind: 'open-overlay' }).catch((err) => {
      console.warn('[EasyCite] could not reach content script in tab', tabId, err)
    })
  } else {
    console.warn('[EasyCite] no active tab found for command')
  }
})
