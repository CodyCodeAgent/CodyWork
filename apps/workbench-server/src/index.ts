import { join } from 'node:path'
import { homedir } from 'node:os'
import { WorkbenchDb } from './db/index.js'
import { AppContext, startServer } from './routes/index.js'
import { reconcileDemandOperations } from './services/demands.js'

const PORT = Number(process.env.CODYWORK_PORT ?? process.env.CODY_WORKBENCH_PORT ?? 3210)
const DB_PATH = process.env.CODYWORK_DB ?? process.env.CODY_WORKBENCH_DB ?? join(homedir(), '.cody-workbench', 'workspace.db')

const db = new WorkbenchDb(DB_PATH)
const reconciled = reconcileDemandOperations(db)
if (reconciled > 0) console.error(`[codywork] reconciled ${reconciled} interrupted demand operation(s)`)
const appContext: AppContext = { db }
const server = startServer(appContext, PORT)

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
