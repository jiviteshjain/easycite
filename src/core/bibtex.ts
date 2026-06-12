import type { CiteKeyFormat, BibInsertMode } from './settings'
import type { Paper } from './types'

export interface BibEntry {
  type: string
  key: string
  /** Full entry text including @type{...}. */
  text: string
  start: number
  end: number
}

function findEntryEnd(text: string, openBrace: number): number {
  let depth = 1
  for (let i = openBrace + 1; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

export function parseEntries(bib: string): BibEntry[] {
  const entries: BibEntry[] = []
  const re = /@(\w+)\s*\{\s*([^,\s{}]+)\s*,/g
  let m: RegExpExecArray | null
  while ((m = re.exec(bib)) !== null) {
    const type = m[1]!.toLowerCase()
    if (type === 'comment' || type === 'preamble' || type === 'string') continue
    const openBrace = bib.indexOf('{', m.index)
    const end = findEntryEnd(bib, openBrace)
    if (end === -1) continue
    entries.push({ type, key: m[2]!, text: bib.slice(m.index, end + 1), start: m.index, end: end + 1 })
    re.lastIndex = end + 1
  }
  return entries
}

/** Extract a field value from a single BibTeX entry (handles {..}, "..", and bare values). */
export function extractField(entryText: string, field: string): string | undefined {
  const re = new RegExp(`(^|[,{\\s])${field}\\s*=\\s*`, 'i')
  const m = re.exec(entryText)
  if (!m) return undefined
  let i = m.index + m[0].length
  const c = entryText[i]
  if (c === '{') {
    const end = findEntryEnd(entryText, i)
    return end === -1 ? undefined : entryText.slice(i + 1, end)
  }
  if (c === '"') {
    const end = entryText.indexOf('"', i + 1)
    return end === -1 ? undefined : entryText.slice(i + 1, end)
  }
  const end = entryText.slice(i).search(/[,}\n]/)
  return end === -1 ? undefined : entryText.slice(i, i + end).trim()
}

export function stripTex(s: string): string {
  return s
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}~'"`^]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstAuthorSurname(entryText: string): string | undefined {
  const author = extractField(entryText, 'author')
  if (!author) return undefined
  const first = author.split(/\s+and\s+/i)[0]!
  const surname = first.includes(',') ? first.split(',')[0]! : (first.trim().split(/\s+/).pop() ?? '')
  const clean = stripTex(surname).replace(/[^a-zA-Z-]/g, '').replace(/-/g, '')
  return clean || undefined
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'on', 'of', 'for', 'and', 'or', 'in', 'to', 'with', 'is',
  'are', 'at', 'by', 'via', 'from', 'do', 'does', 'can', 'how', 'what', 'why',
  'your', 'towards', 'toward',
])

function titleWords(entryText: string): string[] {
  const title = extractField(entryText, 'title')
  if (!title) return []
  return stripTex(title)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
}

function entryYear(entryText: string): string | undefined {
  const year = extractField(entryText, 'year')
  const m = year?.match(/\d{4}/)
  return m?.[0]
}

export function generateKey(entryText: string, format: CiteKeyFormat): string | undefined {
  if (format === 'source') return undefined
  const surname = firstAuthorSurname(entryText)
  const year = entryYear(entryText) ?? ''
  if (!surname) return undefined
  if (format === 'AuthorYear') {
    return surname.charAt(0).toUpperCase() + surname.slice(1) + year
  }
  const word = titleWords(entryText)[0] ?? ''
  return surname.toLowerCase() + year + word
}

export function rewriteKey(entryText: string, newKey: string): string {
  return entryText.replace(/^(\s*@\w+\s*\{\s*)[^,\s{}]+/, `$1${newKey}`)
}

function normalizeTitleForComparison(title: string | undefined): string {
  return stripTex(title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export type BibInsertion =
  | { kind: 'exists'; key: string }
  | { kind: 'insert'; key: string; from: number; insert: string; renamedFrom?: string }

/** Same paper iff normalized titles match and neither year nor first author contradicts. */
function isSamePaper(a: string, b: string): boolean {
  const titleA = normalizeTitleForComparison(extractField(a, 'title'))
  const titleB = normalizeTitleForComparison(extractField(b, 'title'))
  if (!titleA || titleA !== titleB) return false
  const yearA = entryYear(a)
  const yearB = entryYear(b)
  if (yearA && yearB && Math.abs(Number(yearA) - Number(yearB)) > 2) return false
  const authorA = firstAuthorSurname(a)?.toLowerCase()
  const authorB = firstAuthorSurname(b)?.toLowerCase()
  if (authorA && authorB && authorA !== authorB) return false
  return true
}

/**
 * Plan the insertion of `entryText` into `bib`.
 * - Same paper already present (title + year + author) -> reuse its key, no edit.
 * - Key collision with a different paper -> rename: add the second title word,
 *   then fall back to b, c, ... suffixes.
 * - Position: alphabetical by key, or append at end.
 */
export function planBibInsertion(bib: string, entryText: string, mode: BibInsertMode): BibInsertion {
  const entries = parseEntries(bib)
  const dup = entries.find((e) => isSamePaper(e.text, entryText))
  if (dup) return { kind: 'exists', key: dup.key }

  let entry = entryText.trim()
  let key = parseEntries(entry)[0]?.key ?? ''
  let renamedFrom: string | undefined
  const existingKeys = new Set(entries.map((e) => e.key))
  if (existingKeys.has(key)) {
    const base = key
    const candidates: string[] = []
    const secondWord = titleWords(entry)[1]
    if (secondWord && !base.endsWith(secondWord)) candidates.push(base + secondWord)
    for (let i = 1; i < 26; i++) candidates.push(base + String.fromCharCode(97 + i)) // b, c, ...
    key = candidates.find((c) => !existingKeys.has(c)) ?? `${base}_${Date.now()}`
    renamedFrom = base
    entry = rewriteKey(entry, key)
  }

  if (mode === 'alphabetical') {
    const next = entries.find((e) => e.key.toLowerCase() > key.toLowerCase())
    if (next) {
      const lineStart = bib.lastIndexOf('\n', next.start - 1) + 1
      return { kind: 'insert', key, from: lineStart, insert: `${entry}\n\n`, renamedFrom }
    }
  }

  const trimmedEnd = bib.replace(/\s+$/, '').length
  const prefix = trimmedEnd === 0 ? '' : '\n\n'
  return { kind: 'insert', key, from: trimmedEnd, insert: `${prefix}${entry}\n`, renamedFrom }
}

/**
 * A fetched entry is usable when it carries the fields a citation needs;
 * some Crossref DOI transforms (corrections, junk registrations) come back
 * without title or author and should be replaced by a synthesized entry.
 */
export function isCompleteBibtex(entry: string): boolean {
  return Boolean(extractField(entry, 'title') && extractField(entry, 'author'))
}

/**
 * Build a BibTeX entry from search-result metadata. Last resort for papers
 * whose source provides no fetchable BibTeX (e.g. OpenReview notes without
 * a _bibtex field).
 */
export function synthesizeBibtex(p: Paper): string {
  const surname = (p.authors[0]?.trim().split(/\s+/).pop() ?? '').replace(/[^a-zA-Z]/g, '')
  const titleWord =
    p.title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .find((w) => w.length > 1 && !STOPWORDS.has(w)) ?? ''
  const key = `${surname.toLowerCase() || 'unknown'}${p.year ?? ''}${titleWord}`
  const venue = p.venue.replace(/\b(oral|poster|oralposter|spotlight|notable)\b/gi, '').trim()
  const official = p.official && venue !== ''
  const type = p.bibType ?? (official ? 'inproceedings' : 'misc')
  const venueField = type === 'article' ? 'journal' : 'booktitle'
  const fields = [
    `  title = {${p.title}}`,
    p.authors.length > 0 ? `  author = {${p.authors.join(' and ')}}` : undefined,
    official ? `  ${venueField} = {${venue}}` : undefined,
    p.year ? `  year = {${p.year}}` : undefined,
    p.url ? `  url = {${p.url}}` : undefined,
  ].filter(Boolean)
  return `@${type}{${key},\n${fields.join(',\n')},\n}`
}

/**
 * Locate previously inserted text for undo: prefer the recorded position,
 * fall back to a unique occurrence elsewhere (concurrent edits may have
 * shifted it). Returns -1 when it's gone or ambiguous.
 */
export function findInsertedText(content: string, from: number, text: string): number {
  if (content.slice(from, from + text.length) === text) return from
  const first = content.indexOf(text)
  if (first === -1) return -1
  return content.indexOf(text, first + 1) === -1 ? first : -1
}
