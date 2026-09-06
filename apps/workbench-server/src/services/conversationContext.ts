import { execFileSync } from 'node:child_process'
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

function gitCommonDirectory(repositoryPath: string): string | null {
  try {
    const path = execFileSync('git', ['-C', repositoryPath, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return path ? resolve(repositoryPath, path) : null
  } catch {
    return null
  }
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
    const gitMetadataRoots = demand.repositories.flatMap(repository => {
      const row = this.database.db.prepare('SELECT baseline_path FROM repositories WHERE id = ? AND workspace_id = ?')
        .get(repository.id, demand.workspaceId) as { baseline_path?: string } | undefined
      const gitDirectory = row?.baseline_path ? gitCommonDirectory(row.baseline_path) : null
      return gitDirectory ? [gitDirectory] : []
    })
    const demandPath = resolve(workspacePath, 'worktrees', demand.worktreeKey)
    // Linked Worktrees keep objects, refs, locks and logs in the baseline
    // repository's common Git directory. The whole common directory is
    // intentionally writable so a Demand can commit and push its own branch;
    // baseline working-tree files remain outside the writable roots.
    const writableRoots = [...repositories, resolve(demandPath, 'docs'), ...gitMetadataRoots]
    const bundle = resolveInstructionBundle({ workspacePath, demandPath, repositoryPaths: repositories })
    return withPermission({
      workspacePath,
      demandPath,
      instructionBundle: bundle,
      effectivePolicy: resolveEffectivePolicy({ workspacePath, readableRoots: [], writableRoots, shell: 'disabled', approval: 'workbench' }),
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
