import { getSandbox } from "@cloudflare/sandbox"
import { createOpencode, createOpencodeServer, proxyToOpencode } from "@cloudflare/sandbox/opencode"
import type { Part } from "@opencode-ai/sdk/v2"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { Hono } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import { css, Style } from "hono/css"
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer"

export { Sandbox } from "@cloudflare/sandbox"

const USER_ID_COOKIE = "mpp_uid"

const app = new Hono<{
  Bindings: Cloudflare.Env
  Variables: { userId: string }
}>()

app.use("*", async (context, next) => {
  let userId = getCookie(context, USER_ID_COOKIE)
  if (!userId) {
    userId = crypto.randomUUID()
    setCookie(context, USER_ID_COOKIE, userId, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 365
    })
  }
  context.set("userId", userId)
  await next()
})

const globalStyles = css`
  :-hono-global {
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
  }
`

const wrapperClass = css`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
`

const chromeClass = css`
  background: var(--surface);
  overflow: hidden;
  flex: 1;
  display: flex;
  flex-direction: column;
`

const titlebarClass = css`
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);
  gap: 12px;
`

const dotsClass = css`
  display: flex;
  gap: 6px;
  & span {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
`

const dotRed = css`
  background: #ef4444;
`
const dotYellow = css`
  background: #eab308;
`
const dotGreen = css`
  background: #22c55e;
`

const containerClass = css`
  flex: 1;
  padding: 12px 4px 4px;
`

app.get(
  "*",
  jsxRenderer(({ children }) => {
    const context = useRequestContext()
    const userId = context.get("userId")
    return (
      <html lang='en'>
        <head>
          <meta charset='UTF-8' />
          <meta
            name='viewport'
            content='width=device-width, initial-scale=1.0'
          />
          <meta
            name='sandbox-id'
            content={userId}
          />
          <link
            rel='icon'
            href='https://tempo.xyz/favicon.ico'
          />
          <title>MPP Sandbox</title>
          <Style />
        </head>
        <body class={globalStyles}>
          {children}
          {import.meta.env.PROD ? (
            <script
              type='module'
              src='/static/client.js'
            />
          ) : (
            <script
              type='module'
              src='/src/client.ts'
            />
          )}
        </body>
      </html>
    )
  })
)

app.get("/", context => {
  return context.render(
    <div class={wrapperClass}>
      <div class={chromeClass}>
        <div class={titlebarClass}>
          <div class={dotsClass}>
            <span class={dotRed} />
            <span class={dotYellow} />
            <span class={dotGreen} />
          </div>
          <span id='termTitle'>mpp-sandbox</span>
        </div>
        <div
          id='terminal-container'
          class={containerClass}
        />
      </div>
    </div>
  )
})

app.get("/api/me", context => context.json({ userId: context.get("userId") }))

app.post("/api/test", async context => {
  const sandbox = getSandbox(context.env.Sandbox, context.get("userId"))
  return handleSdkTest(sandbox)
})

app.all("/ws/terminal", async context =>
  handleTerminal(context.req.raw, context.env, context.get("userId"))
)

app.all("/api/terminal", async context =>
  handleTerminal(context.req.raw, context.env, context.get("userId"))
)

// Catch-all: proxy to opencode web UI
app.all("*", async context => {
  const sandbox = getSandbox(context.env.Sandbox, context.get("userId"))
  const server = await createOpencodeServer(sandbox, {})
  return proxyToOpencode(context.req.raw, sandbox, server)
})

async function handleTerminal(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url)
  const sandboxId =
    url.searchParams.get("id") ??
    url.searchParams.get("sandbox") ??
    url.searchParams.get("sandboxId") ??
    userId
  const sandbox = getSandbox(env.Sandbox, sandboxId)
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
}

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

export default app satisfies ExportedHandler<Cloudflare.Env>
