import type { Part } from "@opencode-ai/sdk/v2"
import { Hono } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import { html } from "hono/html"
import { getSandbox } from "@cloudflare/sandbox"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createOpencode, createOpencodeServer, proxyToOpencode } from "@cloudflare/sandbox/opencode"

export { Sandbox } from "@cloudflare/sandbox"

const USER_ID_COOKIE = "mpp_uid"

const app = new Hono<{ Bindings: Env }>()

app.use("*", async (c, next) => {
  let userId = getCookie(c, USER_ID_COOKIE)
  if (!userId) {
    userId = crypto.randomUUID()
    setCookie(c, USER_ID_COOKIE, userId, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 365
    })
  }
  c.set("userId" as never, userId)
  await next()
})

function getUserId(c: { get: (key: string) => string }): string {
  return c.get("userId" as never)
}

// ── HTML Page ──

const TerminalPage = ({ userId }: { userId: string }) => (
  <html lang='en'>
    <head>
      <meta charset='UTF-8' />
      <meta
        name='viewport'
        content='width=device-width, initial-scale=1.0'
      />
      <title>MPP Sandbox — Try the Machine Payments Protocol</title>
      {html`
        <style>
          :root {
            --bg: #0a0a0a;
            --surface: #141414;
            --border: #2a2a2a;
            --text: #e0e0e0;
            --muted: #888;
            --accent: #22c55e;
            --accent-dim: #166534;
          }
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
          }
          .terminal-wrapper {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
          }
          .terminal-chrome {
            background: var(--surface);
            overflow: hidden;
            flex: 1;
            display: flex;
            flex-direction: column;
          }
          .terminal-container {
            padding: 6px 8px;
          }
          .terminal-titlebar {
            display: flex;
            align-items: center;
            padding: 10px 16px;
            border-bottom: 1px solid var(--border);
            font-size: 12px;
            color: var(--muted);
            gap: 12px;
          }
          .terminal-dots {
            display: flex;
            gap: 6px;
          }
          .terminal-dots span {
            width: 10px;
            height: 10px;
            border-radius: 50%;
          }
          .dot-red {
            background: #ef4444;
          }
          .dot-yellow {
            background: #eab308;
          }
          .dot-green {
            background: #22c55e;
          }
          #terminal-container {
            flex: 1;
            padding: 4px;
          }
        </style>
      `}
    </head>
    <body>
      <div class='terminal-wrapper'>
        <div class='terminal-chrome'>
          <div class='terminal-titlebar'>
            <div class='terminal-dots'>
              <span class='dot-red' />
              <span class='dot-yellow' />
              <span class='dot-green' />
            </div>
            <span id='termTitle'>mpp-sandbox</span>
          </div>
          <div id='terminal-container' />
        </div>
      </div>

      {html`<script type="module">
				import {
					FitAddon,
					init,
					Terminal
				} from "https://cdn.jsdelivr.net/npm/ghostty-web@0.4.0/dist/ghostty-web.js"

				const SANDBOX_ID = "${userId}"
				let terminal = null
				let ws = null
				let sessionId = null

				async function launch() {
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
					window.terminal = terminal

					const fitAddon = new FitAddon()
					terminal.loadAddon(fitAddon)

					const _urlRe = /(https?:\\/\\/[^\\s<>'"\\)\\]},;]+)/g
					const _foundUrls = []

					function trackOutput(data) {
						const text = typeof data === "string" ? data : new TextDecoder().decode(data)
						const clean = text.replace(/\\x1b(?:\\[[0-9;]*[a-zA-Z]|\\][^\\x07]*\\x07)/g, "")
						_urlRe.lastIndex = 0
						let m
						while ((m = _urlRe.exec(clean)) !== null) {
							_foundUrls.push(m[0])
						}
					}

					function findUrlAtRow(row) {
						const rowTexts = []
						try {
							const buf = terminal.buffer.active
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
						} catch (_) {}

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
						const canvas = container.querySelector("canvas")
						if (!canvas) return 20
						return canvas.height / window.devicePixelRatio / terminal.rows
					}

					window._foundUrls = _foundUrls
					window.findUrlAtRow = findUrlAtRow

					terminal.open(container)
					fitAddon.fit()
					fitAddon.observeResize()

					const termEl = container
					termEl.addEventListener("click", e => {
						if (!e.metaKey && !e.ctrlKey) return
						const rect = termEl.getBoundingClientRect()
						const y = e.clientY - rect.top
						const row = Math.floor(y / getCharHeight())
						const url = findUrlAtRow(row)
						if (url) {
							e.preventDefault()
							window.open(url, "_blank")
						}
					})
					termEl.addEventListener("mousemove", e => {
						if (!e.metaKey && !e.ctrlKey) {
							termEl.style.cursor = ""
							return
						}
						const rect = termEl.getBoundingClientRect()
						const y = e.clientY - rect.top
						const row = Math.floor(y / getCharHeight())
						const url = findUrlAtRow(row)
						termEl.style.cursor = url ? "pointer" : ""
					})

					const proto = location.protocol === "https:" ? "wss:" : "ws:"
					const wsUrl = proto + "//" + location.host + "/ws/terminal?id=" + SANDBOX_ID + "&session=" + sessionId + "&cols=" + terminal.cols + "&rows=" + terminal.rows

					ws = new WebSocket(wsUrl)
					ws.binaryType = "arraybuffer"

					const encoder = new TextEncoder()

					ws.onopen = () => {
						document.getElementById("termTitle").textContent =
							"mpp-sandbox — " + sessionId.slice(0, 8)
					}

					ws.onmessage = event => {
						if (event.data instanceof ArrayBuffer) {
							const bytes = new Uint8Array(event.data)
							trackOutput(bytes)
							terminal.write(bytes)
							return
						}
						if (typeof event.data === "string") {
							try {
								const msg = JSON.parse(event.data)
								if (msg.type === "ready") {
									terminal.focus()
									terminal.clear()
									_foundUrls.length = 0
								} else if (msg.type === "error") {
									console.error("PTY error:", msg.message)
								} else if (msg.type === "exit") {
									terminal.write("\\r\\n\\x1b[33m[Process exited with code " + msg.code + "]\\x1b[0m\\r\\n")
								}
							} catch {
								trackOutput(event.data)
								terminal.write(event.data)
							}
						}
					}

					ws.onclose = () => {
						terminal.write("\\r\\n\\x1b[33m[Session ended. Refresh to start a new sandbox.]\\x1b[0m\\r\\n")
					}

					ws.onerror = () => {
						terminal.write("\\r\\n\\x1b[31m[Connection error. Check console for details.]\\x1b[0m\\r\\n")
					}

					terminal.onData(data => {
						if (ws && ws.readyState === WebSocket.OPEN) {
							ws.send(encoder.encode(data))
						}
					})

					terminal.onResize(({ cols, rows }) => {
						if (ws && ws.readyState === WebSocket.OPEN) {
							ws.send(JSON.stringify({ type: "resize", cols, rows }))
						}
					})

					terminal.attachCustomWheelEventHandler(event => {
						const isAltScreen = terminal.wasmTerm?.isAlternateScreen?.()
						if (!isAltScreen) return false

						if (!ws || ws.readyState !== WebSocket.OPEN) return true

						if (terminal.hasMouseTracking()) {
							const canvas = container.querySelector("canvas")
							if (canvas) {
								const rect = canvas.getBoundingClientRect()
								const cellW = rect.width / terminal.cols
								const cellH = rect.height / terminal.rows
								const col = Math.max(1, Math.min(terminal.cols, Math.floor((event.clientX - rect.left) / cellW) + 1))
								const row = Math.max(1, Math.min(terminal.rows, Math.floor((event.clientY - rect.top) / cellH) + 1))
								const button = event.deltaY < 0 ? 64 : 65
								const ticks = Math.min(Math.abs(Math.round(event.deltaY / 33)), 5)
								for (let i = 0; i < ticks; i++) {
									ws.send(encoder.encode("\\x1b[<" + button + ";" + col + ";" + row + "M"))
								}
							}
						}

						return true
					})
				}

				launch()
			</script>`}
    </body>
  </html>
)

// ── Routes ──

app.get("/", c => {
  const userId = getUserId(c)
  return c.html(<TerminalPage userId={userId} />)
})

app.get("/api/me", c => {
  return c.json({ userId: getUserId(c) })
})

app.post("/api/test", async c => {
  const userId = getUserId(c)
  const sandbox = getSandbox(c.env.Sandbox, userId)
  return handleSdkTest(sandbox)
})

app.all("/ws/terminal", async c => {
  const request = c.req.raw
  const url = new URL(request.url)
  const userId = getUserId(c)
  const sandboxId =
    url.searchParams.get("id") ??
    url.searchParams.get("sandbox") ??
    url.searchParams.get("sandboxId") ??
    userId
  const sandbox = getSandbox(c.env.Sandbox, sandboxId)
  const sessionId = url.searchParams.get("session") ?? url.searchParams.get("sid") ?? undefined
  const parsedCols = Number.parseInt(url.searchParams.get("cols") || "80", 10)
  const parsedRows = Number.parseInt(url.searchParams.get("rows") || "24", 10)
  const cols = Number.isNaN(parsedCols) ? 80 : parsedCols
  const rows = Number.isNaN(parsedRows) ? 24 : parsedRows
  const terminalRequest = sessionId ? withSessionIdParam(request, sessionId) : request

  await sandbox.setKeepAlive(true)

  if (sessionId) {
    const session = await sandbox.getSession(sessionId)
    return session.terminal(terminalRequest, { cols, rows })
  }

  // @ts-expect-error - TODO: fix this
  return sandbox.terminal(terminalRequest, { cols, rows })
})

app.all("/api/terminal", async c => {
  const request = c.req.raw
  const url = new URL(request.url)
  const userId = getUserId(c)
  const sandboxId =
    url.searchParams.get("id") ??
    url.searchParams.get("sandbox") ??
    url.searchParams.get("sandboxId") ??
    userId
  const sandbox = getSandbox(c.env.Sandbox, sandboxId)
  const sessionId = url.searchParams.get("session") ?? url.searchParams.get("sid") ?? undefined
  const parsedCols = Number.parseInt(url.searchParams.get("cols") || "80", 10)
  const parsedRows = Number.parseInt(url.searchParams.get("rows") || "24", 10)
  const cols = Number.isNaN(parsedCols) ? 80 : parsedCols
  const rows = Number.isNaN(parsedRows) ? 24 : parsedRows
  const terminalRequest = sessionId ? withSessionIdParam(request, sessionId) : request

  await sandbox.setKeepAlive(true)

  if (sessionId) {
    const session = await sandbox.getSession(sessionId)
    return session.terminal(terminalRequest, { cols, rows })
  }

  // @ts-expect-error - TODO: fix this
  return sandbox.terminal(terminalRequest, { cols, rows })
})

// Catch-all: proxy to opencode web UI
app.all("*", async c => {
  const userId = getUserId(c)
  const sandbox = getSandbox(c.env.Sandbox, userId)
  const server = await createOpencodeServer(sandbox, {})
  return proxyToOpencode(c.req.raw, sandbox, server)
})

// ── Helpers ──

function withSessionIdParam(request: Request, sessionId: string): Request {
  const terminalUrl = new URL(request.url)
  terminalUrl.searchParams.set("sessionId", sessionId)
  terminalUrl.searchParams.delete("sid")
  terminalUrl.searchParams.delete("session")
  return new Request(terminalUrl, request)
}

async function handleSdkTest(sandbox: ReturnType<typeof getSandbox>): Promise<Response> {
  try {
    const { client } = await createOpencode<OpencodeClient>(sandbox, {})
    const session = await client.session.create({ title: "Test Session" })

    if (!session.data) {
      throw new Error(`Failed to create session: ${JSON.stringify(session)}`)
    }

    const promptResult = await client.session.prompt({
      sessionID: session.data.id,
      parts: [
        {
          type: "text",
          text: "Summarize the README.md file in 2-3 sentences. Be concise."
        }
      ]
    })

    const parts = promptResult.data?.parts ?? []
    const textPart = parts.find(
      (part): part is Part & { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string"
    )

    return new Response(textPart?.text ?? "No response", {
      headers: { "Content-Type": "text/plain" }
    })
  } catch (error) {
    console.error("SDK test error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    const stack = error instanceof Error ? error.stack : undefined
    return Response.json({ success: false, error: message, stack }, { status: 500 })
  }
}

export default app
