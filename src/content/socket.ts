// Minimal socket.io 0.9 client for Overleaf's realtime OT channel. Lets us
// edit a .bib doc without opening it in the editor. Protocol reference:
// github.com/iamhyc/Overleaf-Workshop docs/webapi.md.

interface Folder {
  _id: string
  name: string
  docs: { _id: string; name: string }[]
  folders: Folder[]
}

export interface JoinedProject {
  rootFolder: Folder[]
}

const CONNECT_TIMEOUT_MS = 5000
const ACK_TIMEOUT_MS = 5000

export class OverleafSocket {
  private ws!: WebSocket
  private nextMsgId = 1
  private acks = new Map<number, { resolve: (args: unknown[]) => void; reject: (e: Error) => void }>()
  private events = new Map<string, (args: unknown[]) => void>()
  private closed = false

  static async connect(projectId: string): Promise<{ socket: OverleafSocket; project: JoinedProject }> {
    const handshakeUrl = `${location.origin}/socket.io/1/?projectId=${projectId}&t=${Date.now()}`
    const res = await fetch(handshakeUrl, { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Socket handshake failed (HTTP ${res.status})`)
    const sid = (await res.text()).split(':')[0]
    if (!sid) throw new Error('Socket handshake returned no session id')

    const socket = new OverleafSocket()
    const wsUrl = `${location.origin.replace(/^http/, 'ws')}/socket.io/1/websocket/${sid}?projectId=${projectId}`
    const project = await socket.start(wsUrl, projectId)
    return { socket, project }
  }

  private start(wsUrl: string, projectId: string): Promise<JoinedProject> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close()
        reject(new Error('Timed out joining project over websocket'))
      }, CONNECT_TIMEOUT_MS)

      let connected = false
      const finish = (project: JoinedProject) => {
        clearTimeout(timer)
        resolve(project)
      }

      // Newer Overleaf pushes joinProjectResponse unprompted when the
      // connection carries ?projectId; older servers need an explicit emit.
      this.events.set('joinProjectResponse', (args) => {
        const payload = args[0] as { project?: JoinedProject }
        if (payload?.project) finish(payload.project)
      })

      this.ws = new WebSocket(wsUrl)
      this.ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Websocket connection failed'))
      }
      this.ws.onclose = () => {
        this.closed = true
        for (const { reject: r } of this.acks.values()) r(new Error('Socket closed'))
        this.acks.clear()
      }
      this.ws.onmessage = (event) => {
        this.onFrame(String(event.data))
        if (!connected && String(event.data).startsWith('1::')) {
          connected = true
          setTimeout(() => {
            if (this.acks.size === 0 && !this.closed) {
              this.emit('joinProject', [{ project_id: projectId }])
                .then((args) => finish(args[0] as JoinedProject))
                .catch(() => {})
            }
          }, 500)
        }
      }
    })
  }

  private onFrame(frame: string): void {
    if (frame.startsWith('2::')) {
      this.ws.send('2::')
      return
    }
    if (frame.startsWith('5:')) {
      const json = frame.slice(frame.indexOf(':::') + 3)
      try {
        const { name, args } = JSON.parse(json)
        this.events.get(name)?.(args ?? [])
      } catch {
        // ignore unparseable events
      }
      return
    }
    if (frame.startsWith('6:::')) {
      const body = frame.slice(4)
      const m = body.match(/^(\d+)\+?(.*)$/s)
      if (!m) return
      const entry = this.acks.get(Number(m[1]))
      if (!entry) return
      this.acks.delete(Number(m[1]))
      const args = m[2] ? (JSON.parse(m[2]) as unknown[]) : []
      const err = args[0]
      if (err) {
        const message =
          typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : String(err)
        entry.reject(new Error(message))
      } else {
        entry.resolve(args.slice(1))
      }
    }
  }

  /** Emit an event and resolve with the ack args (minus the leading error slot). */
  emit(name: string, args: unknown[]): Promise<unknown[]> {
    if (this.closed) return Promise.reject(new Error('Socket closed'))
    const id = this.nextMsgId++
    const frame = `5:${id}+::${JSON.stringify({ name, args })}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.acks.delete(id)
        reject(new Error(`Timed out waiting for ${name} ack`))
      }, ACK_TIMEOUT_MS)
      this.acks.set(id, {
        resolve: (a) => {
          clearTimeout(timer)
          resolve(a)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.ws.send(frame)
    })
  }

  async joinDoc(docId: string): Promise<{ content: string; version: number }> {
    const [docLines, version] = await this.emit('joinDoc', [docId, { encodeRanges: true }])
    if (!Array.isArray(docLines) || typeof version !== 'number') {
      throw new Error('Unexpected joinDoc response shape')
    }
    return { content: docLines.join('\n'), version }
  }

  async applyInsert(docId: string, position: number, text: string, version: number): Promise<void> {
    await this.emit('applyOtUpdate', [docId, { doc: docId, op: [{ p: position, i: text }], v: version }])
  }

  async leaveDoc(docId: string): Promise<void> {
    await this.emit('leaveDoc', [docId]).catch(() => {})
  }

  close(): void {
    this.closed = true
    try {
      this.ws?.close()
    } catch {
      // already closed
    }
  }
}

/** Find a doc id by project-relative path like "sub/references.bib". */
export function findDocIdByPath(project: JoinedProject, path: string): string | undefined {
  const parts = path.replace(/^\//, '').split('/')
  let folders = project.rootFolder
  for (let i = 0; i < parts.length - 1; i++) {
    const next = folders.flatMap((f) => f.folders ?? []).find((f) => f.name === parts[i])
    if (!next) return undefined
    folders = [next]
  }
  const fileName = parts[parts.length - 1]!
  for (const folder of folders) {
    const doc = (folder.docs ?? []).find((d) => d.name === fileName)
    if (doc) return doc._id
  }
  return undefined
}
