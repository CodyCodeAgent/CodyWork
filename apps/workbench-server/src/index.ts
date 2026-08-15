import { join } from 'node:path'
import { homedir } from 'node:os'
import { WorkbenchDb } from './db/index.js'
import { startServer } from './routes/index.js'

const PORT = Number(process.env.CODY_WORKBENCH_PORT ?? 3210)
const DB_PATH = process.env.CODY_WORKBENCH_DB ?? join(homedir(), '.cody-workbench', 'workbench.db')

const db = new WorkbenchDb(DB_PATH)
const root = process.env.CODY_WORKBENCH_ROOT ?? join(homedir(), 'cody-workbench-workspaces')

const server = startServer({ db, root }, PORT)

process.on('SIGINT', () => {
  server.close(() => {
    db.close()
    process.exit(0)
  })
})
process.on('SIGTERM', () => {
  server.close(() => {
    db.close()
    process.exit(0)
  })
})
