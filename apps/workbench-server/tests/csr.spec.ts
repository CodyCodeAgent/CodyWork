import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  initCsrSkeleton,
  listServiceRepos,
  repoStatus,
  addRepo,
  createDemandSpecs,
  createWorktree,
  removeWorktree,
  listWorktrees,
  listDocs,
  readFile,
  writeFile,
} from '../src/services/csr.js'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'csr-test-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('initCsrSkeleton', () => {
  it('生成完整的 CSR 目录骨架和治理文档', () => {
    const ws = join(root, 'demo')
    initCsrSkeleton(ws, 'demo')

    // 目录结构
    for (const d of ['services', 'docs/arch', 'docs/product-specs', 'docs/references/knowledge', 'docs/rag', 'specs', 'worktrees', '.ttadk', '.codex/skills']) {
      expect(existsSync(join(ws, d))).toBe(true)
    }
    // 治理文档 + AGENTS.md
    for (const f of ['docs/CONSTITUTION.md', 'docs/CODING.md', 'docs/QUALITY.md', 'docs/RELIABILITY.md', 'docs/SECURITY.md', 'docs/README.md', 'AGENTS.md']) {
      expect(existsSync(join(ws, f))).toBe(true)
    }
    // AGENTS.md 包含三条铁律
    const agents = readFile(ws, 'AGENTS.md')
    expect(agents).toContain('只读')
    expect(agents).toContain('worktrees')
    expect(agents).toContain('compound')
  })
})

describe('listDocs / readFile / writeFile', () => {
  it('列出 docs 下所有文件（相对路径）', () => {
    const ws = join(root, 'docs-test')
    initCsrSkeleton(ws, 'docs-test')
    const files = listDocs(ws)
    expect(files).toContain('CODING.md')
    expect(files).toContain('CONSTITUTION.md')
    expect(files.some(f => f === 'README.md')).toBe(true)
  })

  it('readFile 读取内容，writeFile 覆盖内容', () => {
    const ws = join(root, 'rw-test')
    initCsrSkeleton(ws, 'rw-test')
    writeFile(ws, 'docs/CODING.md', '# 新编码规范\n')
    expect(readFile(ws, 'docs/CODING.md')).toBe('# 新编码规范\n')
  })

  it('路径越界被拒绝', () => {
    const ws = join(root, 'escape-test')
    initCsrSkeleton(ws, 'escape-test')
    expect(() => readFile(ws, '../outside.md')).toThrow()
  })
})

describe('createDemandSpecs', () => {
  it('生成 specs/<日期>-<slug>/ 下的 5 个模板', () => {
    const ws = join(root, 'demand-test')
    initCsrSkeleton(ws, 'demand-test')
    const dir = createDemandSpecs(ws, 'order-boost')
    expect(dir).toContain('specs/')
    expect(dir.endsWith('order-boost')).toBe(true)
    for (const f of ['spec.md', 'plan.md', 'tasks.md', 'review.md', 'test-report.md']) {
      expect(existsSync(join(dir, f))).toBe(true)
    }
    // spec.md 有基本结构
    expect(readFile(ws, dir.replace(ws + '/', '') + '/spec.md')).toContain('## 背景')
  })
})

describe('git 操作（真实 git 仓库）', () => {
  it('addRepo 克隆 + repoStatus 报告状态 + listServiceRepos', () => {
    const ws = join(root, 'git-test')
    initCsrSkeleton(ws, 'git-test')

    // 造一个本地 git 仓库
    const src = join(root, 'source-repo')
    mkdirSync(src, { recursive: true })

    execFileSync('git', ['init', '-q'], { cwd: src })
    writeFileSync(join(src, 'README.md'), '# hello\n')
    execFileSync('git', ['add', 'README.md'], { cwd: src })
    execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: src })

    // clone
    const r = addRepo(ws, src)
    expect(r.ok).toBe(true)
    expect(r.name).toBe('source-repo')

    // 列表
    expect(listServiceRepos(ws)).toContain('source-repo')

    // 状态
    const st = repoStatus(ws, 'source-repo')
    expect(st).not.toBeNull()
    expect(st?.branch).toBe('master')
    expect(st?.dirty).toBe(false)
  })

  it('createWorktree 建分支 + listWorktrees + removeWorktree', () => {
    const ws = join(root, 'wt-test')
    initCsrSkeleton(ws, 'wt-test')

    const src = join(root, 'wt-source')
    mkdirSync(src, { recursive: true })

    execFileSync('git', ['init', '-q'], { cwd: src })
    writeFileSync(join(src, 'a.txt'), 'a\n')
    execFileSync('git', ['add', '.'], { cwd: src })
    execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: src })

    addRepo(ws, src)

    const wt = createWorktree(ws, 'order-boost', 'wt-source')
    expect(wt.ok).toBe(true)
    expect(wt.path).toContain('worktrees/order-boost/services/wt-source')

    const list = listWorktrees(ws, 'order-boost')
    expect(list.length).toBe(1)
    expect(list[0]?.repo).toBe('wt-source')
    expect(list[0]?.branch).toBe('ai/order-boost')

    const rm = removeWorktree(ws, 'order-boost', 'wt-source')
    expect(rm.ok).toBe(true)
    expect(listWorktrees(ws, 'order-boost').length).toBe(0)
  })

  it('重复创建同一仓库的 worktree 被拒绝', () => {
    const ws = join(root, 'wt-dup-test')
    initCsrSkeleton(ws, 'wt-dup-test')
    const src = join(root, 'wt-dup-source')
    mkdirSync(src, { recursive: true })

    execFileSync('git', ['init', '-q'], { cwd: src })
    writeFileSync(join(src, 'a.txt'), 'a\n')
    execFileSync('git', ['add', '.'], { cwd: src })
    execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: src })
    addRepo(ws, src)

    expect(createWorktree(ws, 'dup', 'wt-dup-source').ok).toBe(true)
    expect(createWorktree(ws, 'dup', 'wt-dup-source').ok).toBe(false)
  })
})
