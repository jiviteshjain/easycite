import type { MergedResult, Paper, Provenance } from './types'

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * Score a result by how well it matches the query, in title-match order:
 *  +100 if the title starts with the query (exact prefix typing)
 *  +50  if the query appears as a contiguous substring of the title
 *  +10  per query token that appears as a title word (most common signal)
 *  +5   per query token that appears as an author word (lets author-name
 *       queries surface papers without title overlap)
 */
export function relevanceScore(result: MergedResult, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0
  const p = result.primary
  const titleTokens = tokenize(p.title)
  const titleStr = titleTokens.join(' ')
  const queryStr = queryTokens.join(' ')
  let score = 0
  for (const t of queryTokens) if (titleTokens.includes(t)) score += 10
  if (titleStr.includes(queryStr)) score += titleStr.startsWith(queryStr) ? 100 : 50
  const authorTokens = tokenize(p.authors.join(' '))
  for (const t of queryTokens) if (authorTokens.includes(t)) score += 5
  return score
}

/** Reorder merged results by query-match score; ties keep first-appearance order. */
export function rerankByQuery(results: MergedResult[], query: string): MergedResult[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return results
  return [...results]
    .map((r, i) => ({ r, i, s: relevanceScore(r, tokens) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ r }) => r)
}

function surname(author: string | undefined): string {
  if (!author) return ''
  const last = author.trim().split(/\s+/).pop() ?? ''
  return last.toLowerCase().replace(/[^a-z]/g, '')
}

// 'local' always outranks remote duplicates (max remote rank is 10 + 5):
// "you already have this" beats any version we could fetch. Crossref sits
// below the specialist sources — it is the broad fallback aggregator.
const PROVENANCE_RANK: Record<Provenance, number> = {
  local: 20,
  acl: 5,
  dblp: 4,
  openreview: 3,
  crossref: 2,
  arxiv: 1,
}

export function rank(p: Paper): number {
  return (p.official ? 10 : 0) + PROVENANCE_RANK[p.bibtexSource]
}

function sameGroup(a: Paper, b: Paper): boolean {
  if (normalizeTitle(a.title) !== normalizeTitle(b.title)) return false
  const sa = surname(a.authors[0])
  const sb = surname(b.authors[0])
  if (sa && sb && sa !== sb) return false
  if (a.year && b.year && Math.abs(a.year - b.year) > 2) return false
  return true
}

/**
 * Dedupe papers across sources and rank official versions above preprints.
 * Each result keeps the best paper as primary and the best non-official
 * duplicate as the alternate ("use arXiv version" action).
 */
export function mergeResults(papers: Paper[], preferOfficial: boolean): MergedResult[] {
  const groups: Paper[][] = []
  for (const p of papers) {
    const group = groups.find((g) => sameGroup(g[0]!, p))
    if (group) group.push(p)
    else groups.push([p])
  }

  // Group order follows first appearance; reorder by query-match score later
  // via rerankByQuery. Provenance ranking only decides which duplicate
  // represents the group.
  return groups.map((group): MergedResult => {
    // Tiebreak on BibTeX-in-hand: OpenReview sometimes lists the same paper
    // twice and only one note carries _bibtex.
    const sorted = [...group].sort(
      (a, b) =>
        (preferOfficial
          ? rank(b) - rank(a)
          : PROVENANCE_RANK[b.bibtexSource] - PROVENANCE_RANK[a.bibtexSource]) ||
        Number(Boolean(b.inlineBibtex)) - Number(Boolean(a.inlineBibtex))
    )
    const primary = sorted[0]!
    const alternate = sorted.find((p) => p.official !== primary.official)
    return { primary, alternate }
  })
}
