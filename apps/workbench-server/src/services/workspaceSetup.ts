import { makeId, nowIso } from '../db/index.js'
import { DEFAULT_WORKSPACE_SETUP_PROMPT, delegateWorkspaceInitialization } from '../runtime/bootstrap.js'
import type { RuntimeEvent, WorkspaceInitializationResult } from '../runtime/protocol.js'
import {
  ensureWorkspaceControlPlane,
  inspectWorkspace,
  prepareWorkspaceForAssistedSetup,
  type WorkspaceSource,
} from './workspace.js'
import type { WorkspaceRegistration, WorkspaceView } from './workspaceRegistry.js'

export type WorkspaceSetupStage = 'preflight' | 'agent' | 'verify' | 'register' | 'completed' | 'failed'

export interface WorkspaceSetupJob {
  id: string
  status: 'running' | 'completed' | 'failed'
  stage: WorkspaceSetupStage
  progress: number
  title: string
  source: WorkspaceSource
  prompt: string
  response: string
  events: Array<{ type: string; timestamp: string; text: string }>
  path?: string
  workspace?: WorkspaceView
  error?: string
  startedAt: string
  finishedAt?: string
}

interface PreparedWorkspace {
  path: string
  name: string
  check: { status: string; message: string }
}

export interface WorkspaceSetupDependencies {
  prepare(source: WorkspaceSource): PreparedWorkspace
  ensureControlPlane(path: string): string[]
  inspect(path: string): { check: { status: string; message: string; missing: string[] } }
  initialize(path: string, onEvent: (event: RuntimeEvent) => void, prompt: string): Promise<WorkspaceInitializationResult>
  register(path: string, name?: string): WorkspaceRegistration
  makeId(): string
  now(): string
  prompt: string
}

const defaultDependencies = (register: WorkspaceSetupDependencies['register']): WorkspaceSetupDependencies => ({
  prepare: prepareWorkspaceForAssistedSetup,
  ensureControlPlane: ensureWorkspaceControlPlane,
  inspect: inspectWorkspace,
  initialize: (path, onEvent, prompt) => delegateWorkspaceInitialization(path, process.env, onEvent, prompt),
  register,
  makeId: () => makeId('workspace_setup'),
  now: nowIso,
  prompt: DEFAULT_WORKSPACE_SETUP_PROMPT,
})

function setupEventText(event: RuntimeEvent): string {
  const data = event.data
  const text = typeof data.text === 'string' ? data.text : typeof data.error === 'string' ? data.error : event.type
  return text.replace(/\s+/g, ' ').trim().slice(0, 2_000)
}

export class WorkspaceSetupCoordinator {
  private readonly jobs = new Map<string, WorkspaceSetupJob>()
  private readonly completions = new Map<string, Promise<void>>()
  private readonly dependencies: WorkspaceSetupDependencies

  constructor(registerOrDependencies: WorkspaceSetupDependencies['register'] | WorkspaceSetupDependencies) {
    this.dependencies = typeof registerOrDependencies === 'function'
      ? defaultDependencies(registerOrDependencies)
      : registerOrDependencies
  }

  start(source: WorkspaceSource, name?: string): WorkspaceSetupJob {
    const job: WorkspaceSetupJob = {
      id: this.dependencies.makeId(),
      status: 'running',
      stage: 'preflight',
      progress: 5,
      title: '检查目录与 Git 状态',
      source,
      prompt: this.dependencies.prompt,
      response: '',
      events: [],
      startedAt: this.dependencies.now(),
    }
    this.jobs.set(job.id, job)
    const completion = this.run(job, name).finally(() => this.completions.delete(job.id))
    this.completions.set(job.id, completion)
    return job
  }

  get(id: string): WorkspaceSetupJob {
    const job = this.jobs.get(id)
    if (!job) throw new Error('Workspace 初始化任务不存在或已过期')
    return job
  }

  async wait(id: string): Promise<WorkspaceSetupJob> {
    await this.completions.get(id)
    return this.get(id)
  }

  private stage(job: WorkspaceSetupJob, stage: WorkspaceSetupStage, progress: number, title: string): void {
    job.stage = stage
    job.progress = progress
    job.title = title
  }

  private appendEvent(job: WorkspaceSetupJob, event: RuntimeEvent): void {
    const text = setupEventText(event)
    if (text) job.events.push({ type: event.type, timestamp: event.timestamp, text })
    if (job.events.length > 120) job.events.splice(0, job.events.length - 120)
    if (event.type === 'assistant.delta' || event.type === 'assistant.completed') {
      const chunk = typeof event.data.text === 'string' ? event.data.text : ''
      if (chunk) job.response = `${job.response}${chunk}`.slice(-24_000)
    }
  }

  private async run(job: WorkspaceSetupJob, name?: string): Promise<void> {
    try {
      const prepared = this.dependencies.prepare(job.source)
      job.path = prepared.path
      job.events.push({ type: 'preflight.completed', timestamp: this.dependencies.now(), text: `${prepared.check.message} 当前状态：${prepared.check.status}` })
      const createdDirectories = this.dependencies.ensureControlPlane(prepared.path)
      job.events.push({
        type: 'control-plane.prepared',
        timestamp: this.dependencies.now(),
        text: createdDirectories.length ? `已准备控制目录：${createdDirectories.join('、')}` : '控制目录已存在，未改动。',
      })
      this.stage(job, 'agent', 25, 'AI 正在审阅并准备 CSR Workspace')

      job.events.push({ type: 'agent.attempt', timestamp: this.dependencies.now(), text: '启动 AI 初始化。写操作不会因连接错误自动重放。' })
      const initialized = await this.dependencies.initialize(prepared.path, event => this.appendEvent(job, event), job.prompt)
      job.response = initialized.message || job.response
      if (initialized.status === 'error') {
        throw new Error(`${initialized.message}（为避免重复修改 Workspace，本任务未自动重试。）`)
      }

      this.stage(job, 'verify', 82, '复检目录、策略文件与 Worktree 容器')
      const check = this.dependencies.inspect(prepared.path).check
      if (check.status !== 'ready') {
        const missing = check.missing.length ? `缺少：${check.missing.join('、')}` : check.message
        throw new Error(`AI 完成后 Workspace 复检未通过：${missing}`)
      }

      this.stage(job, 'register', 94, '登记 Workspace 并刷新仓库状态')
      const registered = this.dependencies.register(prepared.path, name || prepared.name)
      job.workspace = registered.workspace
      this.stage(job, 'completed', 100, registered.created ? 'Workspace 已准备并登记' : 'Workspace 已检查并更新')
      job.status = 'completed'
      job.finishedAt = this.dependencies.now()
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
      this.stage(job, 'failed', 100, '初始化未完成')
      job.finishedAt = this.dependencies.now()
    }
  }
}
