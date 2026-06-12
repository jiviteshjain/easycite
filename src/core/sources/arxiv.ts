import type { Paper } from '../types'

/** arXiv's top-level archive groups; "physics" spans many archive prefixes. */
export const ARXIV_GROUPS: Record<string, string[]> = {
  cs: ['cs'],
  econ: ['econ'],
  eess: ['eess'],
  math: ['math'],
  physics: [
    'astro-ph', 'cond-mat', 'gr-qc', 'hep-ex', 'hep-lat', 'hep-ph', 'hep-th',
    'math-ph', 'nlin', 'nucl-ex', 'nucl-th', 'physics', 'quant-ph',
  ],
  'q-bio': ['q-bio'],
  'q-fin': ['q-fin'],
  stat: ['stat'],
}

export const ARXIV_GROUP_IDS = Object.keys(ARXIV_GROUPS)

export function buildUrl(query: string, categories?: string[]): string {
  let q = `all:${query.trim().split(/\s+/).join(' AND all:')}`
  // cat:X* matches both bare archives (quant-ph) and subcategories (cs.CL).
  const groups = (categories ?? []).filter((g) => g in ARXIV_GROUPS)
  if (groups.length > 0 && groups.length < ARXIV_GROUP_IDS.length) {
    const cats = groups.flatMap((g) => ARXIV_GROUPS[g]!.map((a) => `cat:${a}*`))
    q = `(${q}) AND (${cats.join(' OR ')})`
  }
  return `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&max_results=10`
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m?.[1]
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Regex-based Atom parsing: DOMParser is unavailable in MV3 service workers. */
export function parse(xml: string): Paper[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []
  return entries.flatMap((entry) => {
    const idUrl = tag(entry, 'id')
    const title = tag(entry, 'title')
    if (!idUrl || !title) return []
    const arxivId = idUrl.match(/abs\/(.+?)(v\d+)?$/)?.[1]
    if (!arxivId) return []
    const authors = (entry.match(/<author>[\s\S]*?<\/author>/g) ?? [])
      .map((a) => unescapeXml(tag(a, 'name') ?? ''))
      .filter(Boolean)
    const published = tag(entry, 'published')
    const paper: Paper = {
      sourceId: 'arxiv',
      id: arxivId,
      title: unescapeXml(title.replace(/\s+/g, ' ').trim()),
      authors,
      year: published ? parseInt(published.slice(0, 4), 10) : undefined,
      venue: 'arXiv',
      official: false,
      bibtexSource: 'arxiv',
      bibtexRef: arxivId,
      url: `https://arxiv.org/abs/${arxivId}`,
    }
    return [paper]
  })
}

export function bibtexUrl(arxivId: string): string {
  return `https://arxiv.org/bibtex/${arxivId}`
}
