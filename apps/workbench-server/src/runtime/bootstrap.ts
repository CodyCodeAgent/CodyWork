import { existsSync } from 'node:fs'
import { CodyWorkCodexRuntime } from './codex.js'
import type { RuntimeEvent, WorkspaceInitializationResult } from './protocol.js'

export const DEFAULT_WORKSPACE_SETUP_PROMPT = `You are the CodyWork Workspace setup agent. Inspect the selected directory before changing anything, then prepare it for CSR-style work.

Hard safety rules:
- Do not edit, delete, rename, move, format, or generate application/source code.
- Do not run git commit, reset, clean, checkout, merge, rebase, or create a branch/worktree for a Demand.
- Reading is unrestricted when needed for setup context, but never modify any path outside the selected Workspace.
- Preserve any existing repository exactly where it is. A repository at the Workspace root remains a valid baseline repository; do not move it under services/.

Allowed setup work only:
1. Inspect the directory, Git status, and existing instruction files.
2. Ensure these empty control-plane directories exist when missing: services/, docs/, specs/, worktrees/, and .agents/skills/.
3. Create or improve root CONSTITUTION.md and AGENTS.md. Preserve useful existing rules, make them concise, and clearly state that business code is developed only through Demand Worktrees.
4. Do not create a concrete Demand Worktree or a branch. Only prepare the worktrees/ container; a human must name/select a Demand and repositories before CodyWork creates one.
5. Verify the final directory structure and report: detected repositories, changed setup files, and any blocker.

Before changing AGENTS.md or CONSTITUTION.md, read the existing file if present. Never replace either file wholesale: preserve its existing headings, rules, examples, ownership notes, and project-specific terminology. Make the smallest possible targeted edit (prefer adding a clearly labelled CodyWork/CSR section); if the existing rules conflict with this setup, report the conflict instead of silently deleting or rewriting them.

Use the available tools. Your final response must be a compact, factual setup report in Markdown. Include a “Policy file changes” section that identifies every AGENTS.md/CONSTITUTION.md edit and confirms what existing material was preserved.`

/**
 * Delegate an empty Workspace to the same Codex App Server used for demand
 * development. CodyWork never synthesizes a competing scaffold itself.
 */
export async function delegateWorkspaceInitialization(workspacePath: string, env: NodeJS.ProcessEnv = process.env, onEvent?: (event: RuntimeEvent) => void, instruction?: string): Promise<WorkspaceInitializationResult> {
  if (!existsSync(workspacePath)) return { status: 'error', message: 'Workspace path does not exist' }
  const command = env.CODY_CODEX_COMMAND?.trim() || 'codex app-server --stdio'
  const model = env.CODY_CODEX_MODEL?.trim()
  const runtime = new CodyWorkCodexRuntime({ command, ...(model ? { model } : {}), env })
  try {
    return await runtime.initializeWorkspace({
      workspacePath,
      instruction: instruction ?? (env.CODY_CODEX_INIT_PROMPT?.trim() || DEFAULT_WORKSPACE_SETUP_PROMPT),
      ...(onEvent ? { onEvent } : {}),
    })
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  } finally {
    await runtime.close()
  }
}
