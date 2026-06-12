import type { MergedResult, Paper, Provenance } from './types'

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function surname(author: string | undefined): string {
  if (!author) return ''
  const last = author.trim().split(/\s+/).pop() ?? ''
  return last.toLowerCase().replace(/[^a-z]/g, '')
}

const PROVENANCE_RANK: Record<Provenance, number> = {
  acl: 4,
  dblp: 3,
  openreview: 2,
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

  // Group order follows first appearance, preserving source relevance order;
  // ranking only decides which duplicate represents the group.
  return groups.map((group): MergedResult => {
    const sorted = [...group].sort((a, b) =>
      preferOfficial ? rank(b) - rank(a) : PROVENANCE_RANK[b.bibtexSource] - PROVENANCE_RANK[a.bibtexSource]
    )
    const primary = sorted[0]!
    const alternate = sorted.find((p) => p.official !== primary.official)
    return { primary, alternate }
  })
}
