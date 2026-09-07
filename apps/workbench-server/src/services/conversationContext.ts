import { resolve } from 'node:path'
import type { ConversationPermissionMode, ConversationRow, WorkspaceRow, WorkbenchDb } from '../db/index.js'
import type { RuntimeContext } from '../runtime/protocol.js'
import { resolveEffectivePolicy, resolveInstructionBundle } from '../runtime/policy.js'
import { getDemand } from './demands.js'

export type DemandConversationContext = {
  id: string
  name: string
  branchName: string
  worktreeKey: string
  status: 'in_progress' | 'completed' | 'blocked'
  createdAt: string
  updatedAt: string
  workspaceId: string
  repositories: { id: string; name: string; worktreePath: string }[]
}

function withPermission(context: RuntimeContext, mode: ConversationPermissionMode): RuntimeContext {
  const writable = mode === 'read-only' ? [] : context.effectivePolicy.writableRoots
  return {
    ...context,
    effectivePolicy: resolveEffectivePolicy({
      workspacePath: context.workspacePath,
      readableRoots: context.effectivePolicy.readableRoots,
      writableRoots: writable,
      deniedRoots: context.effectivePolicy.deniedRoots,
      shell: context.effectivePolicy.shell,
      approval: mode === 'yolo' ? 'none' : 'workbench',
    }),
  }
}

/** Resolves CodyWork scope ceilings independently from Runtime session state. */
export class ConversationContextResolver {
  constructor(private readonly database: WorkbenchDb) {}

  demand(workspaceId: string, demandId: string): DemandConversationContext {
    const workspace = this.database.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow | undefined
    if (!workspace) throw new Error('Workspace 不存在')
    const demand = getDemand(this.database, workspace, demandId)
    if (!demand) throw new Error('需求不存在')
    return { ...demand, workspaceId }
  }

  demandContext(demand: DemandConversationContext, mode: ConversationPermissionMode): RuntimeContext {
    const workspacePath = this.workspacePath(demand.workspaceId)
    const repositories = demand.repositories.map(repository => repository.worktreePath)
    const demandPath = resolve(workspacePath, 'worktrees', demand.worktreeKey)
    const bundle = resolveInstructionBundle({ workspacePath, demandPath, repositoryPaths: repositories })
    return withPermission({
      workspacePath,
      demandPath,
      instructionBundle: bundle,
      // This root identifies the native Codex execution workspace and keeps
      // persisted mode inference stable. CodyWork does not enforce it as a
      // filesystem allowlist; the selected Codex sandbox mode owns access.
      effectivePolicy: resolveEffectivePolicy({ workspacePath, readableRoots: [], writableRoots: [demandPath], shell: 'disabled', approval: 'workbench' }),
    }, mode)
  }

  workspaceContext(workspaceId: string): RuntimeContext {
    const workspacePath = this.workspacePath(workspaceId)
    const bundle = resolveInstructionBundle({ workspacePath, workspaceSearch: true })
    return {
      workspacePath,
      instructionBundle: bundle,
      effectivePolicy: resolveEffectivePolicy({
        workspacePath,
        readableRoots: [],
        writableRoots: [],
        shell: 'full',
        approval: 'workbench',
      }),
    }
  }

  forRow(row: ConversationRow): RuntimeContext {
    if (row.scope === 'workspace') return this.workspaceContext(row.workspace_id)
    if (!row.demand_id) throw new Error('需求会话缺少 Demand')
    return this.demandContext(this.demand(row.workspace_id, row.demand_id), 'workspace-write')
  }

  workspacePath(workspaceId: string): string {
    const row = this.database.db.prepare('SELECT path FROM workspaces WHERE id = ?').get(workspaceId) as { path?: string } | undefined
    if (!row?.path) throw new Error('Workspace 不存在')
    return row.path
  }
}
