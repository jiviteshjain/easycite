const CITE_OPEN_RE =
  /\\(cite|citep|citet|citealp|citealt|citeauthor|citeyear|citeyearpar|parencite|textcite|autocite|footcite)\*?\s*(?:\[[^\[\]]*\]\s*){0,2}\{/g

export interface KeyToken {
  text: string
  /** Offsets of the trimmed token text within the doc. */
  start: number
  end: number
  /** Offsets of the full comma-delimited segment (including whitespace). */
  segStart: number
  segEnd: number
}

export interface CiteContext {
  command: string
  openBrace: number
  closeBrace: number
  tokens: KeyToken[]
}

function findBraceClose(doc: string, openBrace: number): number {
  let depth = 1
  for (let i = openBrace + 1; i < doc.length; i++) {
    const c = doc[i]
    if (c === '\\') {
      i++
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function tokenize(doc: string, openBrace: number, closeBrace: number): KeyToken[] {
  const tokens: KeyToken[] = []
  let segStart = openBrace + 1
  for (let i = openBrace + 1; i <= closeBrace; i++) {
    if (i === closeBrace || doc[i] === ',') {
      const seg = doc.slice(segStart, i)
      const trimmedLeft = seg.length - seg.trimStart().length
      const text = seg.trim()
      tokens.push({
        text,
        start: segStart + trimmedLeft,
        end: segStart + trimmedLeft + text.length,
        segStart,
        segEnd: i,
      })
      segStart = i + 1
    }
  }
  return tokens
}

/** Find the cite command whose braces contain the cursor, if any. */
export function findCiteAtCursor(doc: string, cursor: number): CiteContext | null {
  CITE_OPEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CITE_OPEN_RE.exec(doc)) !== null) {
    const openBrace = m.index + m[0].length - 1
    if (openBrace >= cursor) break
    const closeBrace = findBraceClose(doc, openBrace)
    if (closeBrace === -1) continue
    if (cursor > openBrace && cursor <= closeBrace) {
      return {
        command: m[1]!,
        openBrace,
        closeBrace,
        tokens: tokenize(doc, openBrace, closeBrace),
      }
    }
    CITE_OPEN_RE.lastIndex = closeBrace + 1
  }
  return null
}

export interface Insertion {
  from: number
  to: number
  insert: string
  /** Cursor position after the change is applied. */
  cursor: number
}

/**
 * Compute the text change that inserts `key` at `cursor`.
 *
 * Inside a cite command:
 * - cursor strictly inside a key token -> replace that token
 * - cursor at a token boundary -> add the key alongside with ", " separators
 * - empty segment (empty braces, after a comma) -> fill it
 * Outside: wrap in ~\<defaultCommand>{key} (the tilde keeps the citation glued
 * to the preceding word; existing spaces are absorbed into it). Cursor is left
 * inside the braces so the shortcut can be repeated to build a multi-key cite.
 */
export function computeInsertion(
  doc: string,
  cursor: number,
  key: string,
  defaultCommand: string
): Insertion {
  const ctx = findCiteAtCursor(doc, cursor)
  if (!ctx) {
    let from = cursor
    while (from > 0 && (doc[from - 1] === ' ' || doc[from - 1] === '\t')) from--
    const prev = from > 0 ? doc[from - 1]! : ''
    const tilde = prev !== '' && prev !== '\n' && !'([{~'.includes(prev) ? '~' : ''
    const next = doc[cursor] ?? ''
    const trailing = next !== '' && !/[\s.,;:!?)\]}]/.test(next) ? ' ' : ''
    const insert = `${tilde}\\${defaultCommand}{${key}}${trailing}`
    return { from, to: cursor, insert, cursor: from + insert.length - 1 - trailing.length }
  }

  const token =
    ctx.tokens.find((t) => cursor >= t.segStart && cursor <= t.segEnd) ?? ctx.tokens[0]!

  if (token.text === '') {
    return {
      from: token.start,
      to: token.end,
      insert: key,
      cursor: token.start + key.length,
    }
  }
  if (cursor > token.start && cursor < token.end) {
    return { from: token.start, to: token.end, insert: key, cursor: token.start + key.length }
  }
  if (cursor <= token.start) {
    const insert = `${key}, `
    return { from: token.segStart, to: token.start, insert, cursor: token.segStart + key.length }
  }
  const insert = `, ${key}`
  return { from: token.end, to: token.end, insert, cursor: token.end + insert.length }
}

/** Token under the cursor usable as a search seed, only when cursor is strictly inside it. */
export function seedTokenAtCursor(doc: string, cursor: number): KeyToken | null {
  const ctx = findCiteAtCursor(doc, cursor)
  if (!ctx) return null
  const token = ctx.tokens.find((t) => cursor > t.start && cursor < t.end)
  return token && token.text !== '' ? token : null
}

/** Turn a citation key like "Vaswani2017attention" or "smith-jones_2020a" into a search query. */
export function parseKeyHint(token: string): string {
  const runs = token.match(/[a-zA-Z]+|\d+/g) ?? []
  const words: string[] = []
  for (const run of runs) {
    if (/^\d+$/.test(run)) {
      if (run.length === 4 && /^(19|20)/.test(run)) words.push(run)
    } else {
      for (const w of run.split(/(?=[A-Z])/)) {
        if (w.length >= 2) words.push(w.toLowerCase())
      }
    }
  }
  return words.join(' ')
}

/** Extract declared bibliography files from LaTeX source (\bibliography, \addbibresource). */
export function extractBibResources(doc: string): string[] {
  const out: string[] = []
  const re = /\\(?:bibliography|addbibresource|addglobalbib|nobibliography)\s*\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(doc)) !== null) {
    for (const raw of m[1]!.split(',')) {
      const name = raw.trim()
      if (!name) continue
      out.push(name.endsWith('.bib') ? name : `${name}.bib`)
    }
  }
  return [...new Set(out)]
}
