import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  EffectivePolicy,
  InstructionBundle,
  RuntimeInstructionSource,
  RuntimePolicyRootMode,
  RuntimeShellPolicy,
  RuntimeApprovalMode,
} from './protocol.js'

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

// The App Server rejects instructions above 1 MiB. Keep a margin for its own
// generated policy/developer instructions and never inline every SKILL.md: the
// workspace remains readable, so Codex can load a selected skill from disk.
const MAX_SYSTEM_INSTRUCTIONS_CHARS = 800_000
const MAX_NON_SKILL_SOURCE_CHARS = 120_000

function canonicalPath(path: string): string {
  const resolved = resolve(path)
  let probe = resolved
  const suffix: string[] = []
  while (!existsSync(probe) && dirname(probe) !== probe) {
    suffix.unshift(basename(probe))
    probe = dirname(probe)
  }
  try { return join(realpathSync.native(probe), ...suffix) } catch { return resolved }
}

export function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(canonicalPath(root), canonicalPath(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function source(kind: RuntimeInstructionSource['kind'], path: string, label: string): RuntimeInstructionSource | null {
  if (!existsSync(path) || !statSync(path).isFile()) return null
  const content = readFileSync(path, 'utf8')
  return { kind, path, label, sha256: hash(content), content }
}

function skillEntries(root: string): InstructionBundle['skills'] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const path = join(root, entry.name, 'SKILL.md')
      if (!existsSync(path) || !statSync(path).isFile()) return null
      const content = readFileSync(path, 'utf8')
      return { name: entry.name, path, sha256: hash(content) }
    })
    .filter((entry): entry is { name: string; path: string; sha256: string } => entry !== null)
}

function clipped(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 96))}\n\n[内容已截断；请在对应 Workspace 文件中读取完整内容。]`
}

function instructionText(sources: RuntimeInstructionSource[], skills: InstructionBundle['skills']): string {
  const sections: string[] = []
  let remaining = MAX_SYSTEM_INSTRUCTIONS_CHARS
  for (const item of sources) {
    if (item.kind === 'skill' || remaining <= 0) continue
    const heading = `## ${item.label}\n\n`
    const body = clipped(item.content, Math.min(MAX_NON_SKILL_SOURCE_CHARS, Math.max(0, remaining - heading.length)))
    const section = `${heading}${body}`
    if (section.length > remaining) {
      sections.push(clipped(section, remaining))
      remaining = 0
    } else {
      sections.push(section)
      remaining -= section.length + 2
    }
  }

  if (skills.length && remaining > 0) {
    const catalog = `## Workspace skills\n\nAvailable skills are listed below. Their full SKILL.md files are intentionally not inlined; read the relevant file from the Workspace when a skill is selected or needed.\n\n${skills.map(skill => `- ${skill.name}: ${skill.path}`).join('\n')}`
    sections.push(clipped(catalog, remaining))
  }
  return sections.join('\n\n')
}

export interface InstructionBundleInput {
  workspacePath: string
  demandPath?: string
  platformInstructions?: string
  charterPath?: string
  repositoryPaths?: string[]
}

/** Collects policy inputs without granting any filesystem permissions. */
export function resolveInstructionBundle(input: InstructionBundleInput): InstructionBundle {
  const workspacePath = canonicalPath(input.workspacePath)
  const sources: RuntimeInstructionSource[] = []
  if (input.platformInstructions) {
    sources.push({ kind: 'platform', label: 'platform', sha256: hash(input.platformInstructions), content: input.platformInstructions })
  }
  const charter = input.charterPath ?? join(workspacePath, 'CONSTITUTION.md')
  const charterSource = source('charter', charter, 'workspace constitution')
  if (charterSource) sources.push(charterSource)
  const workspaceAgents = source('workspace', join(workspacePath, 'AGENTS.md'), 'workspace AGENTS.md')
  if (workspaceAgents) sources.push(workspaceAgents)
  for (const repositoryPath of input.repositoryPaths ?? []) {
    const path = join(canonicalPath(repositoryPath), 'AGENTS.md')
    const repositorySource = source('repository', path, `${repositoryPath} AGENTS.md`)
    if (repositorySource) sources.push(repositorySource)
  }
  if (input.demandPath) {
    const demandContext = source('demand', join(canonicalPath(input.demandPath), 'docs', 'context.md'), 'demand context')
    if (demandContext) sources.push(demandContext)
  }
  const skills = [
    join(workspacePath, '.agents', 'skills'),
    join(workspacePath, '.codex', 'skills'),
  ]
    .flatMap(skillRoot => skillEntries(skillRoot))
  for (const skill of skills) {
    const content = readFileSync(skill.path, 'utf8')
    sources.push({ kind: 'skill', path: skill.path, label: `skill:${skill.name}`, sha256: skill.sha256, content })
  }
  const systemInstructions = instructionText(sources, skills)
  return {
    systemInstructions,
    sources,
    skills,
    sha256: hash(JSON.stringify({ systemInstructions, skills })),
  }
}

export interface PolicyInput {
  workspacePath: string
  readableRoots?: string[]
  writableRoots?: string[]
  deniedRoots?: string[]
  shell?: RuntimeShellPolicy
  approval?: RuntimeApprovalMode
  readPolicy?: RuntimePolicyRootMode
  writePolicy?: RuntimePolicyRootMode
}

/**
 * Compile the vendor-neutral policy. Writable roots must always be inside the
 * Workspace; a runtime may narrow them further but may never widen them.
 */
export function resolveEffectivePolicy(input: PolicyInput): EffectivePolicy {
  const workspacePath = canonicalPath(input.workspacePath)
  const readableRoots = [...new Set((input.readableRoots?.length ? input.readableRoots : [workspacePath]).map(canonicalPath))]
  const writableRoots = [...new Set((input.writableRoots ?? []).map(canonicalPath))]
  const deniedRoots = [...new Set((input.deniedRoots ?? []).map(canonicalPath))]
  if (writableRoots.some(root => !isWithinRoot(workspacePath, root))) {
    throw new Error('effective policy cannot write outside the Workspace')
  }
  if (readableRoots.some(root => !isWithinRoot(workspacePath, root))) {
    throw new Error('effective policy cannot read outside the Workspace')
  }
  const policy = {
    readableRoots,
    writableRoots,
    deniedRoots,
    shell: input.shell ?? 'disabled',
    approval: input.approval ?? 'workbench',
  }
  return { ...policy, hash: hash(JSON.stringify(policy)) }
}
