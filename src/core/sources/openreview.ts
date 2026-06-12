import type { Paper } from '../types'

export function buildUrl(query: string): string {
  return `https://api2.openreview.net/notes/search?term=${encodeURIComponent(query)}&content=all&source=forum&limit=15`
}

interface OrNote {
  id: string
  pdate?: number
  cdate?: number
  content?: Record<string, { value?: unknown }>
}

function val(note: OrNote, field: string): unknown {
  return note.content?.[field]?.value
}

export function isAccepted(venue: string | undefined, venueid: string | undefined): boolean {
  if (!venue || /^submitted to/i.test(venue)) return false
  if (venueid && /Rejected_Submission|Withdrawn|\/Submission|Desk_Rejected/i.test(venueid)) {
    return false
  }
  return true
}

export function parse(json: string): Paper[] {
  const data = JSON.parse(json)
  const notes: OrNote[] = data?.notes ?? []
  return notes.flatMap((note) => {
    const title = val(note, 'title')
    if (typeof title !== 'string' || !title) return []
    const venue = val(note, 'venue')
    const venueid = val(note, 'venueid')
    // OpenReview mirrors DBLP's catalog (venueid "dblp.org/..."); those records
    // duplicate what the DBLP source returns, with worse metadata — CoRR mirrors
    // even pass the acceptance heuristic and masquerade as official versions.
    if (typeof venueid === 'string' && venueid.startsWith('dblp.org/')) return []
    const official = isAccepted(
      typeof venue === 'string' ? venue : undefined,
      typeof venueid === 'string' ? venueid : undefined
    )
    const authorsRaw = val(note, 'authors')
    const bibtex = val(note, '_bibtex')
    // Venue strings often embed the year ("ICLR 2024") but journals don't;
    // fall back to the publication date (epoch ms).
    const yearMatch = typeof venue === 'string' ? venue.match(/\b(19|20)\d{2}\b/) : null
    const dateMs = note.pdate ?? note.cdate
    const year = yearMatch
      ? parseInt(yearMatch[0], 10)
      : dateMs
        ? new Date(dateMs).getUTCFullYear()
        : undefined
    const paper: Paper = {
      sourceId: 'openreview',
      id: note.id,
      title,
      authors: Array.isArray(authorsRaw) ? authorsRaw.filter((a) => typeof a === 'string') : [],
      year,
      venue: typeof venue === 'string' && venue ? venue : 'OpenReview',
      official,
      bibtexSource: 'openreview',
      bibtexRef: note.id,
      inlineBibtex: typeof bibtex === 'string' ? bibtex : undefined,
      url: `https://openreview.net/forum?id=${note.id}`,
    }
    return [paper]
  })
}
