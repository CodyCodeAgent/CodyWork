import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export interface RunResult {
  ok: boolean
  stdout?: string
  stderr?: string
  error?: string
}

interface ExecError extends Error {
  stderr?: string | Buffer
}

export function runGit(cwd: string, args: string[]): RunResult {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
    return { ok: true, stdout }
  } catch (e) {
    const err = e as ExecError
    return { ok: false, stderr: err.stderr?.toString() ?? '', error: err.message }
  }
}

/**
 * 生成 CSR 项目骨架目录（确定性，不经过 AI）。
 * 对齐 life-csr 结构：services/ docs/ specs/ worktrees/ + 治理文档 + AGENTS.md
 */
export function initCsrSkeleton(root: string, name: string): void {
  mkdirSync(root, { recursive: true })
  const dirs = [
    'services',
    'docs/arch',
    'docs/product-specs',
    'docs/references/knowledge',
    'docs/rag',
    'specs',
    'worktrees',
    '.ttadk',
    '.codex/skills',
  ]
  for (const d of dirs) {
    mkdirSync(join(root, d), { recursive: true })
  }

  const governance = `# ${name} · CSR 治理原则（CONSTITUTION）

本工作台采用 CSR（Central Spec Repo）模型：

- \`services/\`：业务域代码仓库，只读基线。
- \`docs/\`：长期知识库（TTADK 体系），仅通过 compound 流程由 AI 写入。
- \`specs/\`：每个需求的短期上下文（spec/plan/tasks/review/test-report）。
- \`worktrees/\`：每个需求的隔离开发空间。
`
  writeFileSync(join(root, 'docs/CONSTITUTION.md'), governance)

  for (const f of ['CODING.md', 'QUALITY.md', 'RELIABILITY.md', 'SECURITY.md']) {
    writeFileSync(join(root, `docs/${f}`), `# ${f.replace('.md', '')}\n\n（待补充）\n`)
  }

  writeFileSync(join(root, 'docs/README.md'), `# ${name} 知识库

## 目录

- \`arch/\`：架构、服务拓扑、数据模型
- \`product-specs/\`：功能清单、需求模式
- \`references/\`：配置、测试、排障、SQL 定位
- \`references/knowledge/\`：业务知识
- \`rag/\`：本地检索说明

> 本文档由工作台维护；AI 写入 docs/ 必须走 compound 流程。
`)

  writeFileSync(
    join(root, 'AGENTS.md'),
    `# ${name} — CSR 工作区

## 目录约定

- \`services/\`：只读基线，AI 只读不写。
- \`docs/\`：长期知识库，写入只能通过 compound 流程。
- \`specs/<需求>/\`：当前需求的 spec.md / plan.md / tasks.md 等。
- \`worktrees/<需求>/services/<repo>/\`：AI 改代码的唯一合法位置。

## 开发铁律

1. AI 改代码只能在 \`worktrees/<需求名>/services/<仓库名>/\` 下。
2. \`services/\` 是只读基线，仅供 AI 读，不允许写（除非用户显式要求重构）。
3. \`docs/\` 写入只能通过 compound 流程。
`,
  )
}

/** 列出一个目录下所有 git 仓库名（services/ 下）。 */
export function listServiceRepos(root: string): string[] {
  const services = join(root, 'services')
  if (!existsSync(services)) return []
  return readdirSync(services).filter(d => existsSync(join(services, d, '.git')))
}

export interface RepoStatus {
  name: string
  branch: string
  dirty: boolean
  lastCommit: string
}

/** 返回每个服务仓库的分支/状态/最近提交。 */
export function repoStatus(root: string, repoName: string): RepoStatus | null {
  const dir = join(root, 'services', repoName)
  if (!existsSync(join(dir, '.git'))) return null
  const branch = runGit(dir, ['branch', '--show-current']).stdout?.trim() ?? '?'
  const status = runGit(dir, ['status', '--porcelain'])
  const dirty = status.ok && (status.stdout ?? '').trim().length > 0
  const lastCommit = runGit(dir, ['log', '-1', '--pretty=%ar · %s']).stdout?.trim() ?? '—'
  return { name: repoName, branch, dirty, lastCommit }
}

/** clone 一个仓库到 services/ 下。 */
export function addRepo(root: string, url: string): { ok: boolean; name?: string; error?: string } {
  const name = basename(url).replace(/\.git$/, '')
  const dest = join(root, 'services', name)
  if (existsSync(dest)) return { ok: false, error: `仓库 ${name} 已存在` }
  mkdirSync(join(root, 'services'), { recursive: true })
  const r = runGit(root, ['clone', url, `services/${name}`])
  if (!r.ok) return { ok: false, error: r.stderr ?? r.error ?? 'clone 失败' }
  return { ok: true, name }
}

/** 新建需求：生成 specs/<YYYYMMDD>-<slug>/ 模板。 */
export function createDemandSpecs(root: string, slug: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const dir = join(root, 'specs', `${date}-${slug}`)
  mkdirSync(dir, { recursive: true })
  const files: Record<string, string> = {
    'spec.md': `# ${slug} · 需求说明\n\n## 背景\n\n## 目标 & 非目标\n\n## 用户故事 / 验收标准\n\n## 边界条件 & 限制\n\n## 待澄清问题\n`,
    'plan.md': `# ${slug} · 技术方案\n\n## 涉及仓库清单\n\n## 数据模型变更\n\n## 接口契约（含 IDL 改动）\n\n## 风险点 & 回滚方案\n\n## 测试策略\n`,
    'tasks.md': `# ${slug} · 任务拆解\n\n- [ ] T001 （文件路径 / 预估 / 依赖）\n`,
    'review.md': `# ${slug} · Review 记录\n\n## 提交前检查点\n`,
    'test-report.md': `# ${slug} · 测试报告\n\n## 跑了什么 / 结果\n`,
  }
  for (const [f, content] of Object.entries(files)) {
    writeFileSync(join(dir, f), content)
  }
  return dir
}

/** 为需求创建跨仓库 worktree。返回每个仓库的 worktree 路径。 */
export function createWorktree(
  root: string,
  demandSlug: string,
  repoName: string,
  branch = `ai/${demandSlug}`,
): { ok: boolean; path?: string; error?: string } {
  const src = join(root, 'services', repoName)
  const dest = join(root, 'worktrees', demandSlug, 'services', repoName)
  if (!existsSync(join(src, '.git'))) return { ok: false, error: `仓库 ${repoName} 不存在` }
  if (existsSync(dest)) return { ok: false, error: `worktree 已存在: ${dest}` }
  mkdirSync(join(root, 'worktrees', demandSlug, 'services'), { recursive: true })
  const r = runGit(src, ['worktree', 'add', '-b', branch, dest, 'HEAD'])
  if (!r.ok) return { ok: false, error: r.stderr ?? r.error ?? 'worktree 创建失败' }
  return { ok: true, path: dest }
}

export function removeWorktree(root: string, demandSlug: string, repoName: string): RunResult {
  const src = join(root, 'services', repoName)
  const dest = join(root, 'worktrees', demandSlug, 'services', repoName)
  return runGit(src, ['worktree', 'remove', '--force', dest])
}

/** 列出一个需求的 worktree 状态。 */
export function listWorktrees(root: string, demandSlug: string): { repo: string; branch: string; dirty: boolean }[] {
  const dir = join(root, 'worktrees', demandSlug, 'services')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(r => existsSync(join(dir, r, '.git')))
    .map((r) => {
      const branch = runGit(join(dir, r), ['branch', '--show-current']).stdout?.trim() ?? '?'
      const st = runGit(join(dir, r), ['status', '--porcelain'])
      return { repo: r, branch, dirty: st.ok && (st.stdout ?? '').trim().length > 0 }
    })
}

/** 列出 docs/ 目录树（简化：返回相对路径列表）。 */
export function listDocs(root: string): string[] {
  const docs = join(root, 'docs')
  if (!existsSync(docs)) return []
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const rel = prefix ? `${prefix}/${entry}` : entry
      if (statSync(full).isDirectory()) walk(full, rel)
      else out.push(rel)
    }
  }
  walk(docs, '')
  return out.sort()
}

export function readFile(root: string, relPath: string): string {
  const safe = resolve(root, relPath)
  if (!safe.startsWith(resolve(root))) throw new Error('路径越界')
  return readFileSync(safe, 'utf8')
}

export function writeFile(root: string, relPath: string, content: string): void {
  const safe = resolve(root, relPath)
  if (!safe.startsWith(resolve(root))) throw new Error('路径越界')
  writeFileSync(safe, content)
}
