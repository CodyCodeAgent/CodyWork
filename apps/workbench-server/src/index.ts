import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { WorkbenchDb } from './db/index.js'
import { startServer } from './routes/index.js'
import type { AiConfig } from './services/ai.js'
import { KnowledgeIndex } from './services/knowledge.js'
import { ChatManager } from './services/chat.js'

// 仓库根目录（apps/workbench-server/src/index.ts → 上溯三级到仓库根）。
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const PORT = Number(process.env.CODY_WORKBENCH_PORT ?? 3210)
const DB_PATH = process.env.CODY_WORKBENCH_DB ?? join(homedir(), '.cody-workbench', 'workbench.db')

const db = new WorkbenchDb(DB_PATH)
const root = process.env.CODY_WORKBENCH_ROOT ?? join(homedir(), 'cody-workbench-workspaces')

// 知识检索索引（trigram FTS5）。
const search = new KnowledgeIndex(
  process.env.CODY_WORKBENCH_SEARCH_DB ?? join(homedir(), '.cody-workbench', 'search.db'),
)

// AI 生成层：需要 DEEPSEEK_API_KEY + dsh 运行时才启用。
let ai: AiConfig | undefined
let chat: ChatManager | undefined
if (process.env.DEEPSEEK_API_KEY) {
  ai = {
    command: 'node',
    binPath: process.env.CODY_WORKBENCH_BIN ?? join(REPO_ROOT, 'packages/examples/jsonrpc-demo/src/bin.ts'),
    cordisConfig: process.env.CODY_WORKBENCH_CORDIS ?? join(REPO_ROOT, 'examples/jsonrpc-agent/cordis.yml'),
    cwd: process.env.CODY_WORKBENCH_ROOT ?? root,
    model: process.env.CODY_WORKBENCH_MODEL ?? 'deepseek-v4-flash',
    provider: process.env.CODY_WORKBENCH_PROVIDER ?? 'deepseek-official',
  }
  chat = new ChatManager(ai)
}

const server = startServer({ db, root, ai, search, chat }, PORT)

process.on('SIGINT', () => {
  server.close(() => {
    chat?.close().then(() => {
      search.close()
      db.close()
      process.exit(0)
    })
  })
})
process.on('SIGTERM', () => {
  server.close(() => {
    chat?.close().then(() => {
      search.close()
      db.close()
      process.exit(0)
    })
  })
})
