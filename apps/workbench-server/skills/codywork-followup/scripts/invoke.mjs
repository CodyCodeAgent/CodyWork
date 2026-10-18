import { createConnection } from 'node:net'

const [socketPath, tool, raw = '{}'] = process.argv.slice(2)
if (!socketPath || !['list', 'create', 'update', 'pause', 'resume', 'cancel', 'run_now'].includes(tool)) {
  console.error('Usage: node invoke.mjs SOCKET list|create|update|pause|resume|cancel|run_now JSON')
  process.exit(1)
}
let args
try { args = JSON.parse(raw) } catch { console.error('Invalid JSON arguments'); process.exit(1) }
const socket = createConnection(socketPath)
let response = ''
socket.setTimeout(15_000, () => socket.destroy(new Error('Followup bridge timed out; check task list before retrying a write')))
socket.on('connect', () => socket.end(JSON.stringify({ tool, arguments: args }) + '\n'))
socket.on('data', chunk => { response += chunk; if (response.length > 1_048_576) socket.destroy(new Error('Response too large')) })
socket.on('end', () => {
  try { const result = JSON.parse(response); console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1 }
  catch { console.error('Invalid followup bridge response'); process.exitCode = 1 }
})
socket.on('error', error => { console.error(error.message); process.exitCode = 1 })
