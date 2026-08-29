import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { WorkbenchDb } from './db/index.js'
import { AppContext, startServer } from './routes/index.js'
import { reconcileDemandOperations } from './services/demands.js'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const host = argument('--host') ?? process.env.CODYWORK_HOST ?? '127.0.0.1'
const port = Number(argument('--port') ?? process.env.CODYWORK_PORT ?? 3210)
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid CodyWork port: ${port}`)

const databasePath = process.env.CODYWORK_DB ?? join(homedir(), '.cody-workbench', 'workspace.db')
const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const staticRoot = process.env.CODYWORK_WEB_ROOT ?? resolve(moduleDirectory, '../../workbench-web/dist')

const db = new WorkbenchDb(databasePath)
const reconciled = reconcileDemandOperations(db)
if (reconciled > 0) console.error(`[codywork] reconciled ${reconciled} interrupted demand operation(s)`)
const appContext: AppContext = { db }
const server = startServer(appContext, { host, port, staticRoot })

function close() {
  server.close(() => {
    void appContext.conversations?.getRuntime().close().finally(() => {
      void appContext.dashboards?.dispose().finally(() => {
        db.close()
        process.exit(0)
      })
    })
  })
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
