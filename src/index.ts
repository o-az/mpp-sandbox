/**
 * OpenCode + Sandbox SDK Example
 *
 * This example demonstrates both ways to use OpenCode with Sandbox:
 * 1. Web UI - Browse to / for the full OpenCode web experience
 * 2. Programmatic - POST to /api/test for SDK-based automation
 */
import { getSandbox } from '@cloudflare/sandbox'
import type { Part } from '@opencode-ai/sdk/v2'
import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { createOpencode, createOpencodeServer, proxyToOpencode } from '@cloudflare/sandbox/opencode'

export { Sandbox } from '@cloudflare/sandbox'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const sandbox = getSandbox(env.Sandbox, 'opencode')

    if (
      (url.pathname === '/ws/terminal' || url.pathname === '/api/terminal') &&
      request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
    ) {
      return handleTerminal(request, env, url)
    }

    // Programmatic SDK test endpoint
    if (request.method === 'POST' && url.pathname === '/api/test') {
      return handleSdkTest(sandbox)
    }

    // Everything else: Web UI proxy
    const server = await createOpencodeServer(sandbox, {
      // directory: '/home/user/agents',
    })
    return proxyToOpencode(request, sandbox, server)
  }
}

async function handleTerminal(request: Request, env: Env, url: URL): Promise<Response> {
  const sandboxId =
    url.searchParams.get('id') ??
    url.searchParams.get('sandbox') ??
    url.searchParams.get('sandboxId') ??
    'opencode'
  const sandbox = getSandbox(env.Sandbox, sandboxId)
  const sessionId = url.searchParams.get('session') ?? url.searchParams.get('sid') ?? undefined
  const parsedCols = Number.parseInt(url.searchParams.get('cols') || '80', 10)
  const parsedRows = Number.parseInt(url.searchParams.get('rows') || '24', 10)
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
  terminalUrl.searchParams.set('sessionId', sessionId)
  terminalUrl.searchParams.delete('sid')
  terminalUrl.searchParams.delete('session')
  return new Request(terminalUrl, request)
}

/**
 * Test the programmatic SDK access
 */
async function handleSdkTest(sandbox: ReturnType<typeof getSandbox>): Promise<Response> {
  try {
    // Get typed SDK client
    const { client } = await createOpencode<OpencodeClient>(sandbox, {})

    // Create a session
    const session = await client.session.create({
      title: 'Test Session'
    })

    if (!session.data) {
      throw new Error(`Failed to create session: ${JSON.stringify(session)}`)
    }

    // Send a prompt using the SDK
    const promptResult = await client.session.prompt({
      sessionID: session.data.id,
      parts: [
        {
          type: 'text',
          text: 'Summarize the README.md file in 2-3 sentences. Be concise.'
        }
      ]
    })

    // Extract text response from result
    const parts = promptResult.data?.parts ?? []
    const textPart = parts.find(
      (part): part is Part & { type: 'text'; text: string } =>
        part.type === 'text' && typeof part.text === 'string'
    )

    return new Response(textPart?.text ?? 'No response', {
      headers: { 'Content-Type': 'text/plain' }
    })
  } catch (error) {
    console.error('SDK test error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    const stack = error instanceof Error ? error.stack : undefined
    return Response.json({ success: false, error: message, stack }, { status: 500 })
  }
}
