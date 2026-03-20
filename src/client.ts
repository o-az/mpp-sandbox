import { FitAddon, init, Terminal } from "ghostty-web"

let ws: WebSocket | null = null
let sessionId: string | null = null
let terminal: Terminal | null = null

const SANDBOX_ID = document.querySelector('meta[name="sandbox-id"]')?.getAttribute("content")

async function launch() {
  if (!SANDBOX_ID) return

  await init()
  sessionId = crypto.randomUUID()

  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 16,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    theme: {
      background: "#141414",
      foreground: "#e0e0e0",
      cursor: "#22c55e",
      selectionBackground: "#264f35",
      selectionForeground: "#ffffff"
    },
    scrollback: 5000
  })

  const container = document.getElementById("terminal-container")
  if (!container) return

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  // Clickable URLs — uses buffer API with wrapped-line joining
  const _urlRe = /(https?:\/\/[^\s<>'")\]},;]+)/g
  const _foundUrls: string[] = []

  function trackOutput(data: string | ArrayBuffer) {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data)
    const ESC = String.fromCharCode(0x1b)
    const BEL = String.fromCharCode(0x07)
    const clean = text.replace(
      new RegExp(`${ESC}(?:\\[[0-9;]*[a-zA-Z]|\\][^${BEL}]*${BEL})`, "g"),
      ""
    )
    _urlRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = _urlRe.exec(clean)) !== null) {
      _foundUrls.push(m[0])
    }
  }

  function findUrlAtRow(row: number): string | null {
    const rowTexts: string[] = []
    try {
      const buf = terminal!.buffer.active
      if (buf?.getLine) {
        const absRow = (buf.viewportY || 0) + row
        for (let r = absRow - 2; r <= absRow + 2; r++) {
          if (r < 0) continue
          const ln = buf.getLine(r)
          if (!ln) break
          const t = ln.translateToString ? ln.translateToString(true).trim() : ""
          if (t) rowTexts.push(t)
        }
      }
    } catch {}

    for (const url of _foundUrls) {
      for (const text of rowTexts) {
        if (url.includes(text) || text.includes(url)) return url
        _urlRe.lastIndex = 0
        const m = _urlRe.exec(text)
        if (m && url.includes(m[0])) return url
      }
    }

    const joined = rowTexts.join("")
    _urlRe.lastIndex = 0
    const directMatch = _urlRe.exec(joined)
    if (directMatch) return directMatch[0]
    return null
  }

  function getCharHeight() {
    if (!container) return 20

    const canvas = container.querySelector("canvas")
    if (!canvas) return 20
    return canvas.height / window.devicePixelRatio / terminal!.rows
  }

  terminal.open(container)
  fitAddon.fit()
  fitAddon.observeResize()

  // Cmd/Ctrl+click to open URLs, hover for pointer cursor
  container.addEventListener("click", e => {
    if (!e.metaKey && !e.ctrlKey) return
    const rect = container.getBoundingClientRect()
    const y = e.clientY - rect.top
    const row = Math.floor(y / getCharHeight())
    const url = findUrlAtRow(row)
    if (url) {
      e.preventDefault()
      window.open(url, "_blank")
    }
  })
  container.addEventListener("mousemove", e => {
    if (!e.metaKey && !e.ctrlKey) {
      container.style.cursor = ""
      return
    }
    const rect = container.getBoundingClientRect()
    const y = e.clientY - rect.top
    const row = Math.floor(y / getCharHeight())
    const url = findUrlAtRow(row)
    container.style.cursor = url ? "pointer" : ""
  })

  // Connect WebSocket to sandbox terminal
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  const wsUrl = `${proto}//${location.host}/ws/terminal?id=${SANDBOX_ID}&session=${sessionId}&cols=${terminal.cols}&rows=${terminal.rows}`

  ws = new WebSocket(wsUrl)
  ws.binaryType = "arraybuffer"

  const encoder = new TextEncoder()

  ws.onopen = () => {
    document.getElementById("termTitle")!.textContent = `mpp-sandbox — ${sessionId!.slice(0, 8)}`
  }

  ws.onmessage = event => {
    if (event.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(event.data)
      trackOutput(bytes.buffer as ArrayBuffer)
      terminal!.write(bytes)
      return
    }
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === "ready") {
          terminal!.focus()
          terminal!.clear()
          _foundUrls.length = 0
        } else if (msg.type === "error") {
          console.error("PTY error:", msg.message)
        } else if (msg.type === "exit") {
          terminal!.write(`\r\n\x1b[33m[Process exited with code ${msg.code}]\x1b[0m\r\n`)
        }
      } catch {
        trackOutput(event.data)
        terminal!.write(event.data)
      }
    }
  }

  ws.onclose = () => {
    terminal!.write("\r\n\x1b[33m[Session ended. Refresh to start a new sandbox.]\x1b[0m\r\n")
  }

  ws.onerror = () => {
    terminal!.write("\r\n\x1b[31m[Connection error. Check console for details.]\x1b[0m\r\n")
  }

  terminal.onData(data => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(data))
  })

  terminal.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "resize", cols, rows }))
  })

  // Fix: ghostty-web converts wheel events to arrow keys in alternate screen
  // mode, which causes OpenCode to navigate between messages. Instead, send
  // proper SGR mouse wheel events so the TUI handles them as scroll.
  terminal.attachCustomWheelEventHandler(event => {
    const isAltScreen = (terminal as any).wasmTerm?.isAlternateScreen?.()
    if (!isAltScreen) return false

    if (!ws || ws.readyState !== WebSocket.OPEN) return true

    if (terminal!.hasMouseTracking()) {
      const canvas = container.querySelector("canvas")
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const cellW = rect.width / terminal!.cols
        const cellH = rect.height / terminal!.rows
        const col = Math.max(
          1,
          Math.min(terminal!.cols, Math.floor((event.clientX - rect.left) / cellW) + 1)
        )
        const row = Math.max(
          1,
          Math.min(terminal!.rows, Math.floor((event.clientY - rect.top) / cellH) + 1)
        )
        const button = event.deltaY < 0 ? 64 : 65
        const ticks = Math.min(Math.abs(Math.round(event.deltaY / 33)), 5)
        for (let i = 0; i < ticks; i++) {
          ws.send(encoder.encode(`\x1b[<${button};${col};${row}M`))
        }
      }
    }

    return true
  })
}

void launch()
