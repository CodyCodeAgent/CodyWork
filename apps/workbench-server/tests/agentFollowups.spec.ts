import { describe, it, expect, vi } from 'vitest'
import { WorkbenchDb } from '../src/db/index.js'
import { AgentFollowupTools } from '../src/services/agentFollowups.js'
import type { FollowupService } from '../src/services/followupService.js'

describe('Agent followup trusted source binding', () => {
  it('binds creation to the native caller and rejects cross-conversation mutations', async () => {
    const db = new WorkbenchDb(':memory:')
    try {
      db.db.exec("INSERT INTO workspaces(id,name,path,created_at,last_opened_at) VALUES('ws','Fixture','/tmp/followup-agent','now','now'); INSERT INTO conversations(id,scope,workspace_id,native_id,title,created_via,status,permission_mode,policy_hash,instruction_hash,created_at,updated_at) VALUES('source','workspace','ws','native-source','Source','browser','completed','read-only','','','now','now')")
      const create = vi.fn(() => ({ id: 'new-task' })), update = vi.fn()
      const service = { list: vi.fn(() => ({ items: [] })), create, update } as unknown as FollowupService
      const tools = new AgentFollowupTools(db, () => service, () => ({ recipientOpenId: 'ou_fixture' }))
      const call = { conversationId: 'source', threadId: 'native-source', turnId: 'turn', tool: 'create', arguments: { name: 'Check', conversationId: 'forged-source', workspaceId: 'forged-workspace' } }
      expect(await tools.handle(call)).toMatchObject({ saved: true })
      expect(create).toHaveBeenCalledWith('ws', call.arguments, { conversationId: 'source', turnId: 'turn' })
      await expect(tools.handle({ ...call, threadId: 'forged-thread' })).rejects.toThrow('可信')
      await expect(tools.handle({ ...call, tool: 'update', arguments: { taskId: 'another-task', expectedRevision: 1 } })).rejects.toThrow('不属于当前会话')
      expect(update).not.toHaveBeenCalled()
      expect(await tools.handle({ ...call, tool: 'list' })).toMatchObject({ items: [], notificationDefaults: { recipientOpenId: 'ou_fixture' } })
    } finally { db.close() }
  })
})
