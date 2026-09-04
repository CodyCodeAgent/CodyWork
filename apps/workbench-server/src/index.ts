import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkbenchDb } from './db/index.js'
import { AppContext, channelService, isLoopbackBindHost, startServer } from './routes/index.js'
import { reconcileDemandOperations } from './services/demands.js'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const host = argument('--host') ?? process.env.CODYWORK_HOST ?? '127.0.0.1'
const port = Number(argument('--port') ?? process.env.CODYWORK_PORT ?? 3210)
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid CodyWork port: ${port}`)
const password = process.env.CODYWORK_PASSWORD?.trim()
if (!password && !isLoopbackBindHost(host)) {
  throw new Error('CODYWORK_PASSWORD is required when CodyWork listens on a non-loopback host')
}

// Workspace metadata is deployment state, not user-home state. Keeping the
// default next to the running installation makes the service deterministic
// across nohup/systemd restarts and prevents a restart from silently opening a
// new empty database under a different HOME.
const databasePath = process.env.CODYWORK_DB ?? resolve(process.cwd(), '.runtime', 'workspace.db')
const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const staticRoot = process.env.CODYWORK_WEB_ROOT ?? resolve(moduleDirectory, '../../workbench-web/dist')

const db = new WorkbenchDb(databasePath)
const reconciled = reconcileDemandOperations(db)
if (reconciled > 0) console.error(`[codywork] reconciled ${reconciled} interrupted demand operation(s)`)
const appContext: AppContext = { db }
const server = startServer(appContext, { host, port, staticRoot, password })
void channelService(appContext).start().catch(error => console.error(`[codywork] channel startup failed: ${error instanceof Error ? error.message : String(error)}`))

function close() {
  server.closeRealtime(1012, 'service restart')
  server.close(() => {
    void appContext.channels?.close().finally(() => appContext.conversations?.getRuntime().close()).finally(() => {
      void appContext.dashboards?.dispose().finally(() => {
        db.close()
        process.exit(0)
      })
    })
  })
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
