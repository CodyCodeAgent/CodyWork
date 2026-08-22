import { existsSync } from 'node:fs'
import { CodexRuntimeAdapter } from './codex.js'
import type { WorkspaceInitializationResult } from './protocol.js'

/**
 * Delegate an empty Workspace to the same Codex App Server used for demand
 * development. CodyWork never synthesizes a competing scaffold itself.
 */
export async function delegateWorkspaceInitialization(workspacePath: string, env: NodeJS.ProcessEnv = process.env): Promise<WorkspaceInitializationResult> {
  if (!existsSync(workspacePath)) return { status: 'error', message: 'Workspace path does not exist' }
  const command = env.CODY_CODEX_COMMAND?.trim() || 'codex app-server --stdio'
  const model = env.CODY_CODEX_MODEL?.trim()
  const adapter = new CodexRuntimeAdapter({ command, ...(model ? { model } : {}), env })
  try {
    return await adapter.initializeWorkspace({
      workspacePath,
      instruction: env.CODY_CODEX_INIT_PROMPT?.trim() || 'Initialize this empty directory as a CSR Workspace. Create the required services, docs, specs, worktrees, and .agents/skills directories plus concise CONSTITUTION.md and AGENTS.md policy files. Do not create application code or access paths outside this Workspace. Verify the structure and report what was created.',
    })
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  } finally {
    await adapter.close()
  }
}
