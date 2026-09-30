import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'
import { describe, expect, it } from 'vitest'
import { WorkbenchDb, makeId, nowIso } from '../src/db/index.js'
import { TestRuntimeAdapter } from './fixtures/test-runtime.js'
import { ConversationService } from '../src/services/conversations.js'
import { ConversationImageUploads } from '../src/services/imageUploads.js'
import { startServer } from '../src/routes/index.js'
import { createCodyWorkRuntimeRegistry } from '../src/runtime/registry.js'

function runtimeRegistry(adapters: { codex: TestRuntimeAdapter; trae?: TestRuntimeAdapter }) {
  return createCodyWorkRuntimeRegistry('codex', adapters)
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cody-conversations-'))
  mkdirSync(join(root, 'services', 'demo'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'specs'), { recursive: true })
  mkdirSync(join(root, 'worktrees', 'verify', 'services', 'demo'), { recursive: true })
  const db = new WorkbenchDb(':memory:')
  const now = nowIso()
  const workspaceId = makeId('ws')
  const demandId = makeId('demand')
  const repositoryId = makeId('repo')
  db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(workspaceId, 'Conversation Test', root, now, now)
  db.db.prepare('INSERT INTO repositories (id, workspace_id, name, baseline_path, origin_url, default_ref, inspected_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(repositoryId, workspaceId, 'demo', join(root, 'services', 'demo'), null, null, now)
  db.db.prepare('INSERT INTO demands (id, workspace_id, name, branch_name, worktree_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(demandId, workspaceId, 'Verify chat', 'verify', 'verify', 'in_progress', now, now)
  db.db.prepare('INSERT INTO demand_repositories (demand_id, repository_id, branch_name, worktree_path, base_ref, base_commit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(demandId, repositoryId, 'verify', join(root, 'worktrees', 'verify', 'services', 'demo'), 'HEAD', 'test', now)
  return { root, db, workspaceId, demandId }
}

describe('conversation websocket control plane', () => {
  it('falls back to Codex when Trae is not installed or enabled', async () => {
    const test = await fixture()
    const codex = new TestRuntimeAdapter()
    // A configured default from an older settings row must not make application
    // startup or a new conversation depend on the optional Trae executable.
    const conversations = new ConversationService(test.db, runtimeRegistry({ codex }), () => 'trae')

    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Codex without Trae')

    expect(conversation.runtimeType).toBe('codex')
    await expect(conversations.getRuntime().getInfo()).resolves.toMatchObject({ runtimeVersion: 'test-1.0.0' })
    expect(runtimeRegistry({ codex }).list().map(runtime => runtime.id)).toEqual(['codex'])
    await expect(conversations.listAvailableNativeThreads(test.workspaceId, test.demandId, 'trae')).rejects.toThrow('请选择已启用的 Runtime')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('uses the Demand directory as context metadata without constructing a Git allowlist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cody-git-metadata-'))
    const baseline = join(root, 'services', 'demo')
    const worktree = join(root, 'worktrees', 'publish', 'services', 'demo')
    mkdirSync(baseline, { recursive: true })
    mkdirSync(join(root, 'worktrees', 'publish', 'services'), { recursive: true })
    const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    git(baseline, ['init'])
    git(baseline, ['checkout', '-b', 'main'])
    git(baseline, ['config', 'user.email', 'test@example.com'])
    git(baseline, ['config', 'user.name', 'CodyWork Test'])
    writeFileSync(join(baseline, 'README.md'), '# baseline\n')
    git(baseline, ['add', 'README.md'])
    git(baseline, ['commit', '-m', 'initial'])
    git(baseline, ['worktree', 'add', '-b', 'feature/publish', worktree])

    const db = new WorkbenchDb(':memory:')
    const now = nowIso()
    const workspaceId = makeId('ws')
    const demandId = makeId('demand')
    const repositoryId = makeId('repo')
    db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(workspaceId, 'Git metadata test', root, now, now)
    db.db.prepare('INSERT INTO repositories (id, workspace_id, name, baseline_path, origin_url, default_ref, inspected_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(repositoryId, workspaceId, 'demo', baseline, null, 'main', now)
    db.db.prepare('INSERT INTO demands (id, workspace_id, name, branch_name, worktree_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(demandId, workspaceId, 'Publish', 'feature/publish', 'publish', 'in_progress', now, now)
    db.db.prepare('INSERT INTO demand_repositories (demand_id, repository_id, branch_name, worktree_path, base_ref, base_commit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(demandId, repositoryId, 'feature/publish', worktree, 'main', git(baseline, ['rev-parse', 'main']), now)

    class CapturingRuntime extends TestRuntimeAdapter {
      createdContext: Parameters<TestRuntimeAdapter['createConversation']>[0]['context'] | null = null
      override async createConversation(request: Parameters<TestRuntimeAdapter['createConversation']>[0]) {
        this.createdContext = request.context
        return super.createConversation(request)
      }
    }
    const runtime = new CapturingRuntime()
    const conversations = new ConversationService(db, runtime)
    await conversations.create(workspaceId, demandId, 'Git publish')

    expect(runtime.createdContext?.effectivePolicy.writableRoots).toEqual([
      realpathSync(join(root, 'worktrees', 'publish')),
    ])

    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps each conversation on its stored runtime after the default changes', async () => {
    class ProviderRuntime extends TestRuntimeAdapter {
      readonly calls: string[] = []

      override async createConversation(request: Parameters<TestRuntimeAdapter['createConversation']>[0]) {
        this.calls.push(`create:${request.conversationId}`)
        return super.createConversation(request)
      }
      override async resumeConversation(request: Parameters<TestRuntimeAdapter['resumeConversation']>[0]) {
        this.calls.push(`resume:${request.conversationId}:${request.nativeId}`)
        return super.resumeConversation(request)
      }
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        this.calls.push(`send:${request.conversation.id}`)
        return super.submitTurn(request)
      }
      override async renameConversation(conversation: Parameters<TestRuntimeAdapter['renameConversation']>[0], title: string) {
        this.calls.push(`rename:${conversation.id}:${title}`)
        return super.renameConversation(conversation, title)
      }
      override async interrupt(conversation: Parameters<TestRuntimeAdapter['interrupt']>[0]) {
        this.calls.push(`interrupt:${conversation.id}`)
        return super.interrupt(conversation)
      }
    }

    const test = await fixture()
    let defaultRuntime: 'codex' | 'trae' = 'codex'
    const initialCodex = new ProviderRuntime()
    const initialTrae = new ProviderRuntime()
    const conversations = new ConversationService(test.db, runtimeRegistry({ codex: initialCodex, trae: initialTrae }), () => defaultRuntime)

    const codexConversation = await conversations.create(test.workspaceId, test.demandId, 'Existing Codex')
    defaultRuntime = 'trae'
    const traeConversation = await conversations.create(test.workspaceId, test.demandId, 'New Trae')
    expect(codexConversation.runtimeType).toBe('codex')
    expect(traeConversation.runtimeType).toBe('trae')
    expect(initialCodex.calls).toEqual([`create:${codexConversation.id}`])
    expect(initialTrae.calls).toEqual([`create:${traeConversation.id}`])

    // Simulate a service restart after the default has changed. Restoring and
    // sending through the old row must still select Codex, not the new Trae
    // default. The reverse must hold for the Trae row.
    const restoredCodex = new ProviderRuntime()
    const restoredTrae = new ProviderRuntime()
    const restored = new ConversationService(test.db, runtimeRegistry({ codex: restoredCodex, trae: restoredTrae }), () => defaultRuntime)
    await restored.history(test.workspaceId, codexConversation.id)
    await restored.send(test.workspaceId, codexConversation.id, 'continue Codex')
    await restored.rename(test.workspaceId, codexConversation.id, 'Codex renamed')
    await restored.interrupt(test.workspaceId, codexConversation.id)
    await restored.history(test.workspaceId, traeConversation.id)
    await restored.send(test.workspaceId, traeConversation.id, 'continue Trae')

    expect(restoredCodex.calls).toEqual(expect.arrayContaining([
      `resume:${codexConversation.id}:${codexConversation.nativeId}`,
      `send:${codexConversation.id}`,
      `rename:${codexConversation.id}:Codex renamed`,
      `interrupt:${codexConversation.id}`,
    ]))
    expect(restoredTrae.calls).toEqual(expect.arrayContaining([
      `resume:${traeConversation.id}:${traeConversation.nativeId}`,
      `send:${traeConversation.id}`,
    ]))
    expect(restoredCodex.calls).not.toEqual(expect.arrayContaining([`send:${traeConversation.id}`]))
    expect(restoredTrae.calls).not.toEqual(expect.arrayContaining([`send:${codexConversation.id}`]))

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('uses the explicitly selected Runtime for create, list, and bind operations', async () => {
    class TrackingRuntime extends TestRuntimeAdapter {
      listCalls = 0
      override async listNativeThreads(request: Parameters<TestRuntimeAdapter['listNativeThreads']>[0]) {
        this.listCalls += 1
        return super.listNativeThreads(request)
      }
    }

    const test = await fixture()
    const codex = new TrackingRuntime()
    const trae = new TrackingRuntime()
    const conversations = new ConversationService(test.db, runtimeRegistry({ codex, trae }), () => 'codex')

    const created = await conversations.create(test.workspaceId, test.demandId, 'Direct Trae', 'browser', 'trae')
    expect(created.runtimeType).toBe('trae')

    await conversations.listAvailableNativeThreads(test.workspaceId, test.demandId, 'trae')
    expect(trae.listCalls).toBe(1)
    expect(codex.listCalls).toBe(0)

    const bound = await conversations.bind(test.workspaceId, test.demandId, {
      nativeId: 'thread-existing-123', runtimeType: 'trae', title: 'Trae history',
    })
    expect(bound.runtimeType).toBe('trae')
    await expect(conversations.bind(test.workspaceId, test.demandId, {
      nativeId: 'thread-existing-123', runtimeType: 'trae',
    })).rejects.toThrow('已绑定到当前 Demand')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('migrates between Codex and Trae by preserving the source and sending a bounded no-execution handoff', async () => {
    class CapturingRuntime extends TestRuntimeAdapter {
      readonly prompts: string[] = []
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        this.prompts.push(request.prompt)
        return super.submitTurn(request)
      }
    }

    const test = await fixture()
    const codex = new CapturingRuntime()
    const trae = new CapturingRuntime()
    const conversations = new ConversationService(test.db, runtimeRegistry({ codex, trae }), () => 'codex')
    const source = await conversations.create(test.workspaceId, test.demandId, '跨底座上下文')
    await conversations.send(test.workspaceId, source.id, '请保留这个关键结论')
    await new Promise(resolve => setImmediate(resolve))

    const migrated = await conversations.migrateRuntime(test.workspaceId, source.id, 'trae', true)
    await new Promise(resolve => setImmediate(resolve))

    expect(migrated).toMatchObject({
      scope: source.scope,
      demandId: source.demandId,
      runtimeType: 'trae',
      permissionMode: source.permissionMode,
      title: '跨底座上下文 · 切换到 Trae',
    })
    expect(migrated.id).not.toBe(source.id)
    expect(conversations.get(test.workspaceId, source.id)).toMatchObject({ runtimeType: 'codex', title: '跨底座上下文' })
    expect(trae.prompts).toHaveLength(1)
    expect(trae.prompts[0]).toContain('不要执行命令、修改文件、调用工具')
    expect(trae.prompts[0]).toContain('请保留这个关键结论')
    expect(test.db.db.prepare("SELECT action FROM conversation_audits WHERE conversation_id = ? AND action = 'conversation.runtime_migration_started'").get(source.id)).toBeDefined()
    expect(test.db.db.prepare("SELECT action FROM conversation_audits WHERE conversation_id = ? AND action = 'conversation.runtime_migrated'").get(migrated.id)).toBeDefined()

    await expect(conversations.migrateRuntime(test.workspaceId, source.id, 'codex', true)).rejects.toThrow('当前会话已使用目标 Runtime')
    await expect(conversations.migrateRuntime(test.workspaceId, source.id, 'trae', false)).rejects.toThrow('切换 Runtime 需要明确确认')
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('recreates only a missing Trae ACP session after a service restart', async () => {
    class ExpiredTraeRuntime extends TestRuntimeAdapter {
      resumedNativeIds: string[] = []
      createdConversationIds: string[] = []

      override async resumeConversation(request: Parameters<TestRuntimeAdapter['resumeConversation']>[0]) {
        this.resumedNativeIds.push(request.nativeId)
        throw new Error('Resource not found')
      }
      override async createConversation(request: Parameters<TestRuntimeAdapter['createConversation']>[0]) {
        this.createdConversationIds.push(request.conversationId ?? '')
        const created = await super.createConversation(request)
        return { ...created, nativeId: `recreated-${created.nativeId}` }
      }
    }

    const test = await fixture()
    const initialTrae = new TestRuntimeAdapter()
    const initial = new ConversationService(test.db, runtimeRegistry({ codex: new TestRuntimeAdapter(), trae: initialTrae }), () => 'trae')
    const conversation = await initial.create(test.workspaceId, test.demandId, 'Ephemeral Trae session')
    const oldNativeId = conversation.nativeId

    const recoveredTrae = new ExpiredTraeRuntime()
    const recovered = new ConversationService(test.db, runtimeRegistry({ codex: new TestRuntimeAdapter(), trae: recoveredTrae }), () => 'trae')
    await expect(recovered.history(test.workspaceId, conversation.id)).resolves.toEqual({ events: [], watermark: 0 })

    const rebound = recovered.get(test.workspaceId, conversation.id)
    expect(recoveredTrae.resumedNativeIds).toEqual([oldNativeId])
    expect(recoveredTrae.createdConversationIds).toEqual([conversation.id])
    expect(rebound.nativeId).not.toBe(oldNativeId)
    expect(rebound.runtimeType).toBe('trae')
    expect(test.db.db.prepare("SELECT action FROM conversation_audits WHERE conversation_id = ? AND action = 'conversation.trae_session_recreated'").get(conversation.id)).toBeDefined()

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('replays cached Trae UI events after a restart when ACP returns an empty snapshot', async () => {
    class EmptySnapshotTraeRuntime extends TestRuntimeAdapter {
      override async readConversationSnapshot() { return { events: [], watermark: 0 } }
    }

    const test = await fixture()
    const initial = new ConversationService(test.db, runtimeRegistry({ codex: new TestRuntimeAdapter(), trae: new TestRuntimeAdapter() }), () => 'trae')
    const conversation = await initial.create(test.workspaceId, test.demandId, 'Persistent Trae timeline')
    await initial.send(test.workspaceId, conversation.id, 'remember this Trae response')
    await new Promise(resolve => setImmediate(resolve))

    const cachedCount = test.db.db.prepare('SELECT COUNT(*) AS count FROM trae_conversation_events WHERE conversation_id = ?')
      .get(conversation.id) as { count: number }
    expect(cachedCount.count).toBeGreaterThan(0)

    // This adapter models ACP `session/load`: it resumes the native Session
    // but cannot replay its former UI events. The service must hydrate from
    // the Trae-only local cache instead.
    const restarted = new ConversationService(test.db, runtimeRegistry({ codex: new TestRuntimeAdapter(), trae: new EmptySnapshotTraeRuntime() }), () => 'trae')
    const history = await restarted.history(test.workspaceId, conversation.id)
    expect(history.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'user.completed', data: expect.objectContaining({ text: 'remember this Trae response' }) }),
      expect.objectContaining({ type: 'assistant.completed' }),
      expect.objectContaining({ type: 'turn.completed' }),
    ]))

    // Keep a second row so product deletion is permitted, then prove that the
    // cache stays local to the conversation and follows its FK cascade.
    await restarted.create(test.workspaceId, test.demandId, 'Other Trae conversation')
    await restarted.remove(test.workspaceId, conversation.id)
    const afterDelete = test.db.db.prepare('SELECT COUNT(*) AS count FROM trae_conversation_events WHERE conversation_id = ?')
      .get(conversation.id) as { count: number }
    expect(afterDelete.count).toBe(0)

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('compacts Trae replay history into a handoff before clearing it locally', async () => {
    const test = await fixture()
    const runtime = new TestRuntimeAdapter()
    const conversations = new ConversationService(test.db, runtimeRegistry({ codex: new TestRuntimeAdapter(), trae: runtime }), () => 'trae')
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Trae handoff cache')
    await conversations.send(test.workspaceId, conversation.id, 'retain this context before cleaning')
    await new Promise(resolve => setImmediate(resolve))

    const before = conversations.traeCache(test.workspaceId, conversation.id)
    expect(before).toMatchObject({ kind: 'trae' })
    expect(before?.eventCount).toBeGreaterThan(3)
    expect(before?.byteLength).toBeGreaterThan(0)

    await expect(conversations.compactTraeCache(test.workspaceId, conversation.id, false)).rejects.toThrow('明确确认')
    const compacted = await conversations.compactTraeCache(test.workspaceId, conversation.id, true)
    expect(compacted).toMatchObject({ eventCount: 3, compactedAt: expect.any(String) })
    const compactedHistory = await conversations.history(test.workspaceId, conversation.id)
    expect(compactedHistory.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'user.completed', data: expect.objectContaining({ text: expect.stringContaining('交接摘要') }) }),
      expect.objectContaining({ type: 'assistant.completed' }),
    ]))

    await expect(conversations.clearTraeCache(test.workspaceId, conversation.id, false)).rejects.toThrow('明确确认')
    const cleared = await conversations.clearTraeCache(test.workspaceId, conversation.id, true)
    expect(cleared).toMatchObject({ eventCount: 0, byteLength: 0 })
    await expect(conversations.history(test.workspaceId, conversation.id)).resolves.toEqual({ events: [], watermark: 0 })

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('creates first-class Workspace sessions in YOLO and supports every native Codex permission mode', async () => {
    class WorkspaceRuntime extends TestRuntimeAdapter {
      createdContexts: Parameters<TestRuntimeAdapter['createConversation']>[0]['context'][] = []
      override async createConversation(request: Parameters<TestRuntimeAdapter['createConversation']>[0]) {
        this.createdContexts.push(request.context)
        return super.createConversation(request)
      }
    }
    const test = await fixture()
    writeFileSync(join(test.root, 'AGENTS.md'), '# Workspace rules\nRead service rules before changing a service.')
    writeFileSync(join(test.root, 'docs', 'search-guide.md'), '# Search guide\nUse indexed knowledge.')
    const runtime = new WorkspaceRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.createWorkspace(test.workspaceId, 'Workspace research')

    expect(conversation).toMatchObject({ scope: 'workspace', demandId: null, permissionMode: 'yolo', title: 'Workspace research', createdVia: 'browser' })
    const feishuConversation = await conversations.create(test.workspaceId, test.demandId, 'Feishu session', 'feishu')
    expect(feishuConversation.createdVia).toBe('feishu')
    expect(conversations.listWorkspace(test.workspaceId)).toEqual([expect.objectContaining({ id: conversation.id })])
    expect(conversations.list(test.workspaceId, test.demandId)).toEqual([expect.objectContaining({ id: feishuConversation.id, createdVia: 'feishu' })])
    expect(runtime.createdContexts[0]).toMatchObject({
      workspacePath: test.root,
      effectivePolicy: { readableRoots: [], writableRoots: [realpathSync.native(test.root)], shell: 'full', approval: 'none' },
    })
    expect(runtime.createdContexts[0]?.demandPath).toBeUndefined()
    expect(runtime.createdContexts[0]?.instructionBundle.systemInstructions).toContain('Workspace 级会话')
    expect(runtime.createdContexts[0]?.instructionBundle.systemInstructions).toContain('Read service rules before changing a service.')
    expect(runtime.createdContexts[0]?.instructionBundle.systemInstructions).toContain('从 Workspace 根到目标目录逐级查找并读取适用的 AGENTS.md')
    expect(runtime.createdContexts[0]?.instructionBundle.systemInstructions).toContain('docs/search-guide.md')
    const canonicalRoot = realpathSync.native(test.root)
    expect(runtime.createdContexts[1]).toMatchObject({
      demandPath: join(test.root, 'worktrees', 'verify'),
      effectivePolicy: {
        readableRoots: [],
        writableRoots: [join(canonicalRoot, 'worktrees', 'verify')],
      },
    })

    await expect(conversations.send(test.workspaceId, conversation.id, 'run a workspace command')).resolves.toMatchObject({ accepted: true })
    await expect(conversations.setPermission(test.workspaceId, conversation.id, 'workspace-write')).resolves.toMatchObject({ permissionMode: 'workspace-write' })
    await expect(conversations.setPermission(test.workspaceId, conversation.id, 'read-only')).resolves.toMatchObject({ permissionMode: 'read-only' })
    await expect(conversations.setPermission(test.workspaceId, conversation.id, 'yolo')).resolves.toMatchObject({ permissionMode: 'yolo' })
    expect(conversations.get(test.workspaceId, conversation.id).permissionMode).toBe('yolo')
    await expect(conversations.remove(test.workspaceId, conversation.id)).resolves.toEqual({ deleted: true })

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('publishes owner events to a process-lifetime channel tap as well as browser subscribers', async () => {
    const test = await fixture()
    const conversations = new ConversationService(test.db, new TestRuntimeAdapter())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Shared owner bus')
    const channelEvents: string[] = []
    const browserEvents: string[] = []
    const unsubscribeChannel = conversations.events.subscribe({}, event => channelEvents.push(event.type))
    conversations.subscribe(conversation.id, event => browserEvents.push(event.type))

    await conversations.send(test.workspaceId, conversation.id, 'one owner stream')
    await new Promise(resolve => setImmediate(resolve))

    expect(channelEvents).toEqual(browserEvents)
    expect(channelEvents).toContain('turn.completed')
    expect(conversations.get(test.workspaceId, conversation.id).status).toBe('completed')
    unsubscribeChannel()
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('keeps source execution profiles turn-scoped instead of mutating the shared conversation default', async () => {
    class ProfileRuntime extends TestRuntimeAdapter {
      readonly profiles: Array<string | undefined> = []
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        this.profiles.push(request.executionProfile?.permissionMode)
        return super.submitTurn(request)
      }
    }
    const test = await fixture()
    const runtime = new ProfileRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Shared execution profile')

    await conversations.submitCommand({
      workspaceId: test.workspaceId,
      conversationId: conversation.id,
      origin: {
        kind: 'channel', provider: 'feishu', accountId: 'account-1', bindingId: 'binding-1',
        messageId: 'message-1', conversationKey: 'private:chat-1',
      },
      prompt: 'channel command',
      executionProfile: { permissionMode: 'yolo' },
    })
    await conversations.send(test.workspaceId, conversation.id, 'browser command')

    expect(runtime.profiles).toEqual(['yolo', 'workspace-write'])
    expect(conversations.get(test.workspaceId, conversation.id).permissionMode).toBe('workspace-write')
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('routes channel stop, approval and question actions through one origin-aware gateway', async () => {
    class ActionRuntime extends TestRuntimeAdapter {
      readonly actions: Array<{ kind: string; requestId?: string; value?: unknown }> = []
      override async interrupt(conversation: Parameters<TestRuntimeAdapter['interrupt']>[0]) {
        this.actions.push({ kind: 'interrupt' })
        return super.interrupt(conversation)
      }
      async respondApproval(_conversation: { id: string; nativeId: string }, requestId: string, outcome: 'allowed-once' | 'rejected') {
        this.actions.push({ kind: 'approval', requestId, value: outcome })
      }
      async respondQuestion(_conversation: { id: string; nativeId: string }, requestId: string, answer: unknown) {
        this.actions.push({ kind: 'question', requestId, value: answer })
      }
    }
    const test = await fixture()
    const runtime = new ActionRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Channel actions')
    const origin = {
      kind: 'channel' as const, provider: 'feishu' as const, accountId: 'account-1', bindingId: 'binding-1',
      messageId: 'message-1', conversationKey: 'topic:chat-1:root-1',
    }

    await conversations.executeAction({ kind: 'interrupt', workspaceId: test.workspaceId, conversationId: conversation.id, origin })
    await conversations.executeAction({ kind: 'approval.resolve', workspaceId: test.workspaceId, conversationId: conversation.id, origin, requestId: 'approval-1', outcome: 'allowed-once' })
    await conversations.executeAction({ kind: 'question.resolve', workspaceId: test.workspaceId, conversationId: conversation.id, origin, requestId: 'question-1', answer: 'yes' })

    expect(runtime.actions).toEqual([
      { kind: 'interrupt' },
      { kind: 'approval', requestId: 'approval-1', value: 'allowed-once' },
      { kind: 'question', requestId: 'question-1', value: 'yes' },
    ])
    const audits = test.db.db.prepare("SELECT action, data_json FROM conversation_audits WHERE conversation_id = ? AND action IN ('turn.interrupt','approval.resolved','question.resolved') ORDER BY id")
      .all(conversation.id) as Array<{ action: string; data_json: string }>
    expect(audits).toHaveLength(3)
    expect(audits.map(row => JSON.parse(row.data_json))).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: expect.objectContaining({ kind: 'channel', bindingId: 'binding-1', messageId: 'message-1' }) }),
    ]))

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('accepts image uploads only for the owning conversation and serves them through an opaque URL', async () => {
    const test = await fixture()
    const runtime = new TestRuntimeAdapter()
    const uploads = new ConversationImageUploads(test.db, join(test.root, 'uploads'))
    const conversations = new ConversationService(test.db, runtime, undefined, (workspaceId, conversationId, path) => uploads.urlForPath(workspaceId, conversationId, path))
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Attachment owner')
    const server = startServer({ db: test.db, conversations, images: uploads }, { host: '127.0.0.1', port: 0 })
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}/api/workspaces/${test.workspaceId}/conversations/${conversation.id}`

    const upload = await fetch(`${base}/images`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'screen.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }),
    })
    expect(upload.status).toBe(200)
    const payload = await upload.json() as { data: { id: string; url: string } }
    expect(payload.data.url).not.toContain(test.root)
    const image = await fetch(`http://127.0.0.1:${address.port}${payload.data.url}`)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await image.arrayBuffer()).length).toBeGreaterThan(0)

    const sent = await fetch(`${base}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '', images: [payload.data.id] }),
    })
    expect(sent.status).toBe(200)

    await new Promise(resolve => setImmediate(resolve))
    const history = await (await fetch(`${base}/history`)).json() as { data: { events: Array<{ type: string; data: { images?: string[] } }> } }
    expect(history.data.events.find(event => event.type === 'user.completed')?.data.images).toEqual([payload.data.url])

    await new Promise<void>(resolve => server.close(() => resolve()))
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('keeps uploaded images scoped to the conversation and maps native paths back to opaque URLs', async () => {
    const test = await fixture()
    const uploads = new ConversationImageUploads(test.db, join(test.root, 'uploads'))
    const conversations = new ConversationService(
      test.db,
      new TestRuntimeAdapter(),
      undefined,
      (workspaceId, conversationId, path) => uploads.urlForPath(workspaceId, conversationId, path),
    )
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Image turn')
    const uploaded = uploads.upload(test.workspaceId, conversation.id, {
      name: 'proof.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    })
    const localImages = uploads.resolveForTurn(test.workspaceId, conversation.id, [uploaded.id])

    await conversations.send(test.workspaceId, conversation.id, '', 'queue', undefined, undefined, localImages)

    const history = await conversations.history(test.workspaceId, conversation.id)
    expect(history.events.find(event => event.type === 'user.completed')?.data.images).toEqual([uploaded.url])
    expect(uploaded.url).not.toContain(test.root)
    expect(() => uploads.resolveForTurn(test.workspaceId, 'other-conversation', [uploaded.id])).toThrow('不属于当前会话')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('copies channel-downloaded images into conversation-owned storage', async () => {
    const test = await fixture()
    const sourcePath = join(test.root, 'channel-image.png')
    writeFileSync(sourcePath, Buffer.from('iVBORw0KGgo=', 'base64'))
    const uploads = new ConversationImageUploads(test.db, join(test.root, 'uploads'))
    const conversations = new ConversationService(test.db, new TestRuntimeAdapter())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Imported image')

    const imported = uploads.importLocalFile(test.workspaceId, conversation.id, {
      path: sourcePath,
      name: 'from-feishu.png',
      mimeType: 'image/png',
    })
    const [resolved] = uploads.resolveForTurn(test.workspaceId, conversation.id, [imported.id])

    expect(resolved?.path).not.toBe(sourcePath)
    expect(readFileSync(resolved!.path)).toEqual(readFileSync(sourcePath))
    expect(uploads.urlForPath(test.workspaceId, conversation.id, resolved!.path)).toBe(imported.url)
    uploads.removeConversation(test.workspaceId, conversation.id)
    expect(existsSync(sourcePath)).toBe(true)
    expect(existsSync(resolved!.path)).toBe(false)

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('refreshes live Demand contexts when a repository Worktree is added', async () => {
    class ContextTrackingRuntime extends TestRuntimeAdapter {
      updatedContexts: Array<{ conversationId: string; writableRoots: string[] }> = []
      override async updateContext(conversation: Parameters<TestRuntimeAdapter['updateContext']>[0], context: Parameters<TestRuntimeAdapter['updateContext']>[1]): Promise<void> {
        this.updatedContexts.push({ conversationId: conversation.id, writableRoots: context.effectivePolicy.writableRoots })
        await super.updateContext(conversation, context)
      }
    }
    const test = await fixture()
    const runtime = new ContextTrackingRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Existing session')
    const now = nowIso()
    const additionalRepositoryId = makeId('repo')
    const additionalBaseline = join(test.root, 'services', 'additional')
    const additionalWorktree = join(test.root, 'worktrees', 'verify', 'services', 'additional')
    mkdirSync(additionalBaseline, { recursive: true })
    mkdirSync(additionalWorktree, { recursive: true })
    test.db.db.prepare('INSERT INTO repositories (id, workspace_id, name, baseline_path, origin_url, default_ref, inspected_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(additionalRepositoryId, test.workspaceId, 'additional', additionalBaseline, null, 'main', now)
    test.db.db.prepare('INSERT INTO demand_repositories (demand_id, repository_id, branch_name, worktree_path, base_ref, base_commit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(test.demandId, additionalRepositoryId, 'verify', additionalWorktree, 'main', 'test', now)

    await conversations.refreshDemandContexts(test.workspaceId, test.demandId)

    expect(runtime.updatedContexts).toEqual([expect.objectContaining({
      conversationId: conversation.id,
      writableRoots: [realpathSync(join(test.root, 'worktrees', 'verify'))],
    })])
    expect(conversations.get(test.workspaceId, conversation.id).policyHash).not.toBe('')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('never replaces the process owner when Runtime settings are saved', async () => {
    class TrackingRuntime extends TestRuntimeAdapter {
      closeCalls = 0
      override async close(): Promise<void> { this.closeCalls += 1; await super.close() }
    }
    const test = await fixture()
    const runtime = new TrackingRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const server = startServer({ db: test.db, conversations }, { host: '127.0.0.1', port: 0 })
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    const before = test.db.db.prepare('SELECT updated_at FROM runtime_settings WHERE id = 1').get() as { updated_at: string }

    const response = await fetch(`http://127.0.0.1:${address.port}/api/settings/runtime`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: '   ' }),
    })
    expect(response.ok).toBe(true)
    expect(runtime.closeCalls).toBe(0)
    expect(test.db.db.prepare('SELECT updated_at FROM runtime_settings WHERE id = 1').get()).toEqual(before)

    const changed = await fetch(`http://127.0.0.1:${address.port}/api/settings/runtime`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'codex app-server --stdio --new-owner-after-deploy' }),
    })
    expect(changed.ok).toBe(true)
    await expect(changed.json()).resolves.toMatchObject({ ok: true, data: { restartRequired: true } })
    expect(runtime.closeCalls).toBe(0)

    server.close()
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('presents durable lifecycle status without reconstructing native Runtime history', async () => {
    class PendingApprovalRuntime extends TestRuntimeAdapter {
      override async readConversationSnapshot(request: Parameters<TestRuntimeAdapter['readConversationSnapshot']>[0]) {
        const timestamp = nowIso()
        return { watermark: 0, events: [
          { id: 'user', type: 'user.completed' as const, conversationId: request.conversationId, threadId: request.nativeId, turnId: 'turn-pending', timestamp, atIso: timestamp, data: { text: 'inspect this' } },
          { id: 'started', type: 'turn.started' as const, conversationId: request.conversationId, threadId: request.nativeId, turnId: 'turn-pending', timestamp, atIso: timestamp, data: {} },
          { id: 'approval', type: 'approval.requested' as const, conversationId: request.conversationId, threadId: request.nativeId, turnId: 'turn-pending', timestamp, atIso: timestamp, data: { approvalId: 'approval-stale' } },
        ] }
      }
    }
    const test = await fixture()
    const conversations = new ConversationService(test.db, new PendingApprovalRuntime())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Interrupted owner')
    test.db.db.prepare("UPDATE conversations SET status = 'awaiting_approval' WHERE id = ?").run(conversation.id)

    expect(conversations.get(test.workspaceId, conversation.id).status).toBe('awaiting_approval')
    await expect(conversations.history(test.workspaceId, conversation.id)).resolves.toMatchObject({ events: [
      expect.objectContaining({ type: 'user.completed', turnId: 'turn-pending' }),
      expect.objectContaining({ type: 'turn.started', turnId: 'turn-pending' }),
      expect.objectContaining({ type: 'approval.requested', turnId: 'turn-pending' }),
    ] })

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('passes clean text, structured selected skills and steer mode to the Runtime', async () => {
    class CapturingRuntime extends TestRuntimeAdapter {
      requests: Parameters<TestRuntimeAdapter['submitTurn']>[0][] = []
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        this.requests.push(request)
        return super.submitTurn(request)
      }
    }
    const test = await fixture()
    const skillPath = join(test.root, '.agents', 'skills', 'e2e-sample', 'SKILL.md')
    mkdirSync(join(test.root, '.agents', 'skills', 'e2e-sample'), { recursive: true })
    writeFileSync(skillPath, '# E2E sample')
    const runtime = new CapturingRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Structured skill')

    await conversations.send(test.workspaceId, conversation.id, 'Keep this user message clean', 'steer', { skills: [realpathSync(skillPath)] })
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(runtime.requests[0]).toMatchObject({
      prompt: 'Keep this user message clean',
      mode: 'steer',
      settings: { skills: [{ name: 'e2e-sample', path: realpathSync(skillPath) }] },
    })
    await conversations.send(test.workspaceId, conversation.id, '', 'queue', { skills: [realpathSync(skillPath)] })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(runtime.requests[1]).toMatchObject({
      prompt: '',
      mode: 'queue',
      settings: { skills: [{ name: 'e2e-sample', path: realpathSync(skillPath) }] },
    })
    await expect(conversations.send(test.workspaceId, conversation.id, 'unknown skill', 'queue', { skills: ['missing'] })).rejects.toThrow('Skill 不存在')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('includes unresolved Core requests in the owner snapshot, not a second realtime replay', async () => {
    class PendingRuntime extends TestRuntimeAdapter {
      override async readConversationSnapshot(conversation: Parameters<TestRuntimeAdapter['readConversationSnapshot']>[0]) {
        const timestamp = nowIso()
        return { watermark: 4, events: [{
          id: 'approval-live', type: 'approval.requested' as const, conversationId: conversation.conversationId,
          threadId: conversation.nativeId, turnId: 'turn-live', timestamp, atIso: timestamp,
          data: { approvalId: 'approval-live' },
        }] }
      }
    }
    const test = await fixture()
    const conversations = new ConversationService(test.db, new PendingRuntime())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Pending request')
    const snapshot = await conversations.history(test.workspaceId, conversation.id)
    expect(snapshot).toMatchObject({ watermark: 4, events: [expect.objectContaining({ type: 'approval.requested' })] })
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('passes collaboration mode as turn-scoped input without persisting a second owner', async () => {
    class StateRuntime extends TestRuntimeAdapter {
      requests: Array<Parameters<TestRuntimeAdapter['submitTurn']>[0]> = []
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        this.requests.push(request)
        return super.submitTurn(request)
      }
    }
    const test = await fixture()
    const runtime = new StateRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Structured state')

    await conversations.send(test.workspaceId, conversation.id, 'plan this', 'queue', { collaborationMode: 'plan' })
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(runtime.requests).toHaveLength(1)
    expect(runtime.requests[0]?.settings).toMatchObject({ collaborationMode: 'plan' })
    const columns = test.db.db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[]
    expect(columns.map(column => column.name)).not.toEqual(expect.arrayContaining(['goal_json', 'plan_json']))

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('binds an existing Codex thread to one Demand and persists the policy-scoped mapping', async () => {
    class ResumeTrackingRuntime extends TestRuntimeAdapter {
      resumeCalls = 0
      override async resumeConversation(request: Parameters<TestRuntimeAdapter['resumeConversation']>[0]) {
        this.resumeCalls += 1
        return super.resumeConversation(request)
      }
    }
    const test = await fixture()
    const runtime = new ResumeTrackingRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const bound = await conversations.bind(test.workspaceId, test.demandId, { nativeId: 'thread-existing-123', title: 'Existing context' })
    expect(bound.nativeId).toBe('thread-existing-123')
    expect(bound.title).toBe('Existing context')
    await expect(conversations.history(test.workspaceId, bound.id)).resolves.toEqual({ events: [], watermark: 0 })
    // Reading is now an owner snapshot, so the first history load attaches
    // the native thread before it returns its watermark.
    expect(runtime.resumeCalls).toBe(1)
    await expect(conversations.listAvailableNativeThreads(test.workspaceId, test.demandId)).resolves.toEqual([
      expect.objectContaining({ nativeId: 'thread-existing-123', bound: true }),
      expect.objectContaining({ nativeId: 'thread-unbound-456', bound: false }),
    ])
    await expect(conversations.bind(test.workspaceId, test.demandId, { nativeId: 'thread-existing-123' })).rejects.toThrow('已绑定到当前 Demand')
    await conversations.send(test.workspaceId, bound.id, 'attach only when execution starts')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(runtime.resumeCalls).toBe(1)
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('deletes an inactive local session while retaining another Demand session', async () => {
    const test = await fixture()
    const conversations = new ConversationService(test.db, new TestRuntimeAdapter())
    const first = await conversations.create(test.workspaceId, test.demandId, 'Keep this session')
    const removed = await conversations.create(test.workspaceId, test.demandId, 'Remove this session')

    await expect(conversations.history(test.workspaceId, removed.id)).resolves.toEqual({ events: [], watermark: 0 })
    await expect(conversations.remove(test.workspaceId, removed.id)).resolves.toEqual({ deleted: true })
    expect(conversations.list(test.workspaceId, test.demandId).map(conversation => conversation.id)).toEqual([first.id])
    await expect(conversations.history(test.workspaceId, removed.id)).rejects.toThrow('会话不存在')
    await expect(conversations.remove(test.workspaceId, first.id)).rejects.toThrow('至少保留一个会话')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('renames the native Codex thread before committing the local title', async () => {
    class RenameRuntime extends TestRuntimeAdapter {
      renames: Array<{ nativeId: string; title: string }> = []
      failNext = false

      override async renameConversation(conversation: Parameters<TestRuntimeAdapter['renameConversation']>[0], title: string): Promise<void> {
        if (this.failNext) throw new Error('native rename failed')
        await super.renameConversation(conversation, title)
        this.renames.push({ nativeId: conversation.nativeId, title })
      }
    }

    const test = await fixture()
    const runtime = new RenameRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Before')

    await expect(conversations.rename(test.workspaceId, conversation.id, '  After  ')).resolves.toMatchObject({ title: 'After' })
    expect(runtime.renames).toEqual([{ nativeId: conversation.nativeId, title: 'After' }])

    runtime.failNext = true
    await expect(conversations.rename(test.workspaceId, conversation.id, 'Must not persist')).rejects.toThrow('native rename failed')
    expect(conversations.get(test.workspaceId, conversation.id).title).toBe('After')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('refuses to delete a running session', async () => {
    class LiveStateRuntime extends TestRuntimeAdapter {
      activeTurnId = ''
      sessionSnapshot(conversation: { id: string; nativeId: string }) {
        return {
          bindingId: conversation.id,
          threadId: conversation.nativeId,
          activeTurnId: this.activeTurnId,
          pendingRequestCount: 0,
          attached: true,
          runtimeAvailable: true,
        }
      }
    }
    const test = await fixture()
    const runtime = new LiveStateRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const running = await conversations.create(test.workspaceId, test.demandId, 'Running session')
    await conversations.create(test.workspaceId, test.demandId, 'Other session')
    runtime.activeTurnId = 'turn-live'

    await expect(conversations.remove(test.workspaceId, running.id)).rejects.toThrow('正在执行或等待确认')

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('streams live events over WebSocket while history is read from the native thread', async () => {
    const test = await fixture()
    const conversations = new ConversationService(test.db, new TestRuntimeAdapter())
    const server = startServer({ db: test.db, conversations }, { host: '127.0.0.1', port: 0 })
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}/api/workspaces/${test.workspaceId}`
    const first = await (await fetch(`${base}/demands/${test.demandId}/conversations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as { data: { id: string } }
    const second = await (await fetch(`${base}/demands/${test.demandId}/conversations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as { data: { id: string } }
    expect(second.data.id).not.toBe(first.data.id)
    const events: string[] = []
    const secondTabEvents: string[] = []
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/workspaces/${test.workspaceId}/conversations/${first.data.id}/events`)
    const secondTab = new WebSocket(`ws://127.0.0.1:${address.port}/api/workspaces/${test.workspaceId}/conversations/${first.data.id}/events`)
    socket.on('message', (data) => { const message = JSON.parse(String(data)) as { event?: { type: string } }; if (message.event) events.push(message.event.type) })
    secondTab.on('message', (data) => { const message = JSON.parse(String(data)) as { event?: { type: string } }; if (message.event) secondTabEvents.push(message.event.type) })
    await Promise.all([once(socket, 'open'), once(secondTab, 'open')])
    await fetch(`${base}/conversations/${first.data.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(events).toEqual(['command.queued', 'command.bound', 'user.completed', 'turn.started', 'tool.started', 'assistant.delta', 'assistant.completed', 'tool.completed', 'turn.completed'])
    expect(secondTabEvents).toEqual(events)
    expect(test.db.db.prepare('SELECT status FROM conversations WHERE id = ?').get(first.data.id)).toEqual({ status: 'completed' })
    const firstTabClosed = once(socket, 'close')
    socket.close(1000, 'first tab closed')
    await firstTabClosed
    await fetch(`${base}/conversations/${first.data.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'second tab remains connected' }) })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(events).toHaveLength(9)
    expect(secondTabEvents).toHaveLength(18)
    const history = await (await fetch(`${base}/conversations/${first.data.id}/history`)).json() as { data: { events: { type: string }[] } }
    expect(history.data.events.some(event => event.type === 'assistant.delta')).toBe(true)
    const deletion = await (await fetch(`${base}/conversations/${second.data.id}`, { method: 'DELETE' })).json() as { data: { deleted: boolean } }
    expect(deletion.data).toEqual({ deleted: true })
    secondTab.close()
    server.close()
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('does not automatically replay a command rejected before native turn binding', async () => {
    class RejectingRuntime extends TestRuntimeAdapter {
      submitCalls = 0

      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        this.submitCalls += 1
        const clientCommandId = request.clientCommandId ?? 'command-rejected'
        const timestamp = nowIso()
        request.onEvent?.({
          id: 'command-failed', type: 'command.failed', conversationId: request.conversation.id,
          threadId: request.conversation.nativeId, timestamp, atIso: timestamp,
          data: { clientCommandId, error: 'Codex conversation runtime is not available' },
        })
        const failure = Promise.reject(new Error('Codex conversation runtime is not available'))
        void failure.catch(() => undefined)
        return { clientCommandId, started: failure, completed: failure }
      }
    }

    const test = await fixture()
    const runtime = new RejectingRuntime()
    const conversations = new ConversationService(test.db, runtime)
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Do not replay')

    await conversations.send(test.workspaceId, conversation.id, 'must require an explicit retry')
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(runtime.submitCalls).toBe(1)
    expect(conversations.get(test.workspaceId, conversation.id).status).toBe('failed')
    await expect(conversations.history(test.workspaceId, conversation.id)).resolves.toEqual({ events: [], watermark: 0 })
    expect(test.db.db.prepare("SELECT action FROM conversation_audits WHERE conversation_id = ? AND action = 'runtime.resumed'").get(conversation.id)).toBeUndefined()

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('does not reconstruct native history from SQLite failure audits', async () => {
    class FailingRuntime extends TestRuntimeAdapter {
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        const clientCommandId = request.clientCommandId ?? 'command-failed'
        const timestamp = nowIso()
        request.onEvent?.({
          id: 'failed-before-turn', type: 'command.failed', conversationId: request.conversation.id,
          threadId: request.conversation.nativeId, timestamp, atIso: timestamp,
          data: { clientCommandId, error: 'response stream disconnected' },
        })
        const failure = Promise.reject(new Error('response stream disconnected'))
        void failure.catch(() => undefined)
        return { clientCommandId, started: failure, completed: failure }
      }
    }

    const test = await fixture()
    const conversations = new ConversationService(test.db, new FailingRuntime())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Show runtime failure')
    await conversations.send(test.workspaceId, conversation.id, 'do not lose the reason')
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(conversations.get(test.workspaceId, conversation.id).status).toBe('failed')
    await expect(conversations.history(test.workspaceId, conversation.id)).resolves.toEqual({ events: [], watermark: 0 })
    expect(test.db.db.prepare("SELECT action FROM conversation_audits WHERE conversation_id = ? AND action = 'command.failed'").get(conversation.id)).toEqual({ action: 'command.failed' })

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('keeps an upstream operational disconnect distinct from a native terminal failure', async () => {
    class UpstreamFailureRuntime extends TestRuntimeAdapter {
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        const timestamp = nowIso()
        const event = {
          id: 'upstream-disconnected', type: 'turn.disconnected' as const, conversationId: request.conversation.id,
          threadId: request.conversation.nativeId, turnId: 'turn-upstream', timestamp, atIso: timestamp,
          data: {
            cause: 'upstream_response_stream_unrecoverable',
            error: 'Codex 上游响应流恢复失败，未自动重发。',
          },
        }
        request.onEvent?.(event)
        return {
          clientCommandId: request.clientCommandId ?? 'command-upstream',
          started: Promise.resolve({ threadId: request.conversation.nativeId, turnId: 'turn-upstream' }),
          completed: Promise.resolve({ conversation: request.conversation, finalText: '', events: [event] }),
        }
      }
    }

    const test = await fixture()
    const conversations = new ConversationService(test.db, new UpstreamFailureRuntime())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Keep failed outbox')

    await conversations.send(test.workspaceId, conversation.id, 'do not silently resend')
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(conversations.get(test.workspaceId, conversation.id).status).toBe('disconnected')
    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })

  it('persists an interrupted turn as terminal without recording a Runtime failure', async () => {
    class InterruptedRuntime extends TestRuntimeAdapter {
      override submitTurn(request: Parameters<TestRuntimeAdapter['submitTurn']>[0]) {
        const timestamp = nowIso()
        const event = {
          id: 'turn-interrupted', type: 'turn.interrupted' as const, conversationId: request.conversation.id,
          threadId: request.conversation.nativeId, turnId: 'turn-1',
          timestamp, atIso: timestamp, data: { status: 'interrupted' },
        }
        request.onEvent?.(event)
        return {
          clientCommandId: request.clientCommandId ?? 'command-interrupted',
          started: Promise.resolve({ threadId: request.conversation.nativeId, turnId: 'turn-1' }),
          completed: Promise.resolve({ conversation: request.conversation, finalText: '', events: [event] }),
        }
      }
    }

    const test = await fixture()
    const conversations = new ConversationService(test.db, new InterruptedRuntime())
    const conversation = await conversations.create(test.workspaceId, test.demandId, 'Stop cleanly')
    await conversations.send(test.workspaceId, conversation.id, 'stop this turn')
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(conversations.get(test.workspaceId, conversation.id).status).toBe('completed')
    expect(test.db.db.prepare("SELECT action FROM conversation_audits WHERE conversation_id = ? AND action = 'turn.failed'").get(conversation.id)).toBeUndefined()

    test.db.close()
    rmSync(test.root, { recursive: true, force: true })
  })
})
