import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { init, Terminal } from 'ghostty-web'
import { SandboxAddon } from '@cloudflare/sandbox/xterm'

async function run() {
  await init()

  const terminal = new Terminal({ cursorBlink: true })
  const fitAddon = new FitAddon()

  const terminalElement = document.querySelector('div#terminal-container')
  if (!terminalElement) throw new Error('Terminal element not found')

  const addon = new SandboxAddon({
    getWebSocketUrl: ({ sandboxId, sessionId, origin }) => {
      const params = new URLSearchParams({ id: sandboxId })
      if (sessionId) params.set('session', sessionId)
      return `${origin}/ws/terminal?${params}`
    },
    onStateChange: (state, error) => {
      console.log(`Terminal ${state}`, error ?? '')
    }
  })

  terminal.loadAddon(addon)
  terminal.loadAddon(fitAddon)
  terminal.open(terminalElement)
  fitAddon.fit()

  // Connect to the default session
  addon.connect({ sandboxId: 'opencode' })

  window.addEventListener('resize', () => fitAddon.fit())
}

run().catch(error => {
  console.error('Failed to initialize Ghostty terminal', error)
})
