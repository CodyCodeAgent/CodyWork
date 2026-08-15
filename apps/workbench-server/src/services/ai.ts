/**
 * AI 生成层：通过 dsh SDK 驱动 headless agent 产出 SDD 文档。
 * 确定性操作由服务端直做（csr.ts），生成性操作（写 spec/plan/tasks 等）走这里。
 * 需要 DEEPSEEK_API_KEY 才能实际运行；无 key 时优雅返回未配置错误。
 */

import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

export interface AiConfig {
  /** dsh 运行时启动命令（headless jsonrpc-agent）。 */
  command: string
  /** cordis.yml 路径。 */
  cordisConfig: string
  /** 工作区 cwd（需求 specs/ 所在目录）。 */
  cwd: string
  model?: string
  provider?: string
}

export interface SddStep {
  step: 'spec' | 'plan' | 'tasks' | 'review' | 'test-report'
  label: string
  file: string
  instruction: string
}

export const SDD_STEPS: SddStep[] = [
  {
    step: 'spec',
    label: 'Spec（需求说明）',
    file: 'spec.md',
    instruction:
      '阅读当前需求目录下的产品需求（如果提供了 PRD 链接或说明），结合 docs/ 里的长期知识，生成一份清晰的 spec.md。包含：背景、目标与非目标、用户故事/验收标准、边界条件与限制、待澄清问题。用中文。只输出 spec.md 的完整内容，不要输出其他解释。',
  },
  {
    step: 'plan',
    label: 'Plan（技术方案）',
    file: 'plan.md',
    instruction:
      '基于当前需求的 spec.md，结合 services/ 下的代码仓库结构和 docs/ 里的架构知识，生成技术方案 plan.md。包含：涉及仓库清单、数据模型变更、接口契约（含 IDL 改动）、风险点与回滚方案、测试策略。用中文。只输出 plan.md 的完整内容。',
  },
  {
    step: 'tasks',
    label: 'Tasks（任务拆解）',
    file: 'tasks.md',
    instruction:
      '基于 spec.md 和 plan.md，把方案拆解成可执行的小任务 tasks.md。每个任务格式：- [ ] T001 描述（文件路径/预估/依赖）。用中文。只输出 tasks.md 的完整内容。',
  },
  {
    step: 'review',
    label: 'Review（评审记录）',
    file: 'review.md',
    instruction:
      '基于已完成的实现（services/ 和 worktrees/ 下的改动），生成 review.md 提交前检查点记录。用中文。只输出 review.md 的完整内容。',
  },
  {
    step: 'test-report',
    label: 'Test-Report（测试报告）',
    file: 'test-report.md',
    instruction:
      '基于已运行的测试结果，生成 test-report.md 测试报告。用中文。只输出 test-report.md 的完整内容。',
  },
]

/**
 * 用 dsh agent 为指定需求的某个 SDD 步骤生成文档内容。
 * @returns 生成的文档内容（markdown 文本）。
 */
export async function generateSddStep(cfg: AiConfig, demandSlug: string, step: SddStep): Promise<string> {
  const harness = new DeepSeekHarness({
    launch: {
      command: cfg.command,
      args: [cfg.cordisConfig],
      env: { ...process.env },
    },
    cwd: cfg.cwd,
    provider: cfg.provider ?? 'deepseek-official',
    model: cfg.model ?? 'deepseek-v4-flash',
  })

  try {
    const prompt = [
      '你是一个 CSR 工作台的 AI 研发助手。',
      '当前工作区是 CSR（Central Spec Repo）项目，目录结构：',
      '- services/：业务域代码仓库（只读基线）',
      '- docs/：长期知识库（架构、业务知识）',
      '- specs/<需求>/：当前需求的 spec.md / plan.md / tasks.md 等',
      '- worktrees/<需求>/：隔离开发空间',
      '',
      `当前需求：${demandSlug}`,
      `任务：生成「${step.label}」文档（${step.file}）。`,
      '',
      step.instruction,
      '',
      `生成后，请把内容写入 specs/ 下对应需求目录的 ${step.file} 文件（用 write 工具，覆盖已有内容）。`,
      '如果你不确定 specs/ 下需求目录的确切路径，先用 read 或 bash 列出 specs/ 目录找到它。',
    ].join('\n')

    const result = await harness.run(prompt, {
      // 允许 agent 多轮调用工具
    })
    return result.finalResponse
  } finally {
    await harness.close().catch(() => {})
  }
}

/**
 * compound 知识回流：扫描 services/ + specs/，把新增稳定知识沉淀回 docs/。
 * @returns AI 的总结报告（agent 已把内容写入 docs/）。
 */
export async function runCompound(cfg: AiConfig, demandSlug: string): Promise<string> {
  const harness = new DeepSeekHarness({
    launch: {
      command: cfg.command,
      args: [cfg.cordisConfig],
      env: { ...process.env },
    },
    cwd: cfg.cwd,
    provider: cfg.provider ?? 'deepseek-official',
    model: cfg.model ?? 'deepseek-v4-flash',
  })

  try {
    const prompt = [
      '你是一个 CSR 工作台的 AI 研发助手，负责知识回流（compound）。',
      '当前工作区是 CSR 项目：',
      '- services/：业务域代码仓库（只读基线，最新合并后的代码）',
      '- docs/：长期知识库（arch/ product-specs/ references/ rag/）',
      '- specs/<需求>/：刚完成的需求的 spec.md / plan.md / tasks.md 等',
      '',
      `刚完成的需求：${demandSlug}`,
      '任务：扫描该需求的 specs/ 目录和 services/ 里的相关代码，识别出值得沉淀的稳定知识（架构、业务规则、排障经验、SQL 定位等），',
      '然后把这些知识写入 docs/ 的对应位置（arch/、product-specs/、references/ 或 references/knowledge/）。',
      '',
      '规则：',
      '1. 不要修改 services/ 下的任何代码。',
      '2. 优先更新已有文档，避免重复创建。',
      '3. 写入用中文，保持简洁。',
      '4. 完成后，报告你写入了哪些文件、每个文件的要点摘要。',
    ].join('\n')

    const result = await harness.run(prompt)
    return result.finalResponse
  } finally {
    await harness.close().catch(() => {})
  }
}

const TROUBLESHOOT_PERSONA = [
  '你是一个业务排障 Agent。你的职责是：',
  '1. 根据问题描述，结合业务代码、领域知识、现场日志、存储数据，梳理证据链；',
  '2. 定位接口、日志、DB、配置和任务；',
  '3. 输出结论和排障方案。',
  '排障三要素：业务逻辑（代码+领域知识）、现场日志（Argos）、存储数据（DB/TCC/Redis/配置）。',
  '工作区是 CSR 项目：services/（代码）、docs/（知识库）、specs/（需求）。',
  '先读 docs/ 里的排障手册和历史经验（docs/references/），再读 services/ 里的相关代码。',
].join('\n')

/**
 * 排障：用排障 persona 分析问题，结合 CSR 工作区代码和知识库。
 * @returns AI 的排障结论（证据链 + 结论）。
 */
export async function runTroubleshoot(cfg: AiConfig, question: string): Promise<string> {
  const harness = new DeepSeekHarness({
    launch: {
      command: cfg.command,
      args: [cfg.cordisConfig],
      env: {
        ...process.env,
        DSH_SYSTEM_PROMPT: TROUBLESHOOT_PERSONA,
      },
    },
    cwd: cfg.cwd,
    provider: cfg.provider ?? 'deepseek-official',
    model: cfg.model ?? 'deepseek-v4-flash',
  })

  try {
    const prompt = `排障问题：${question}\n\n请按证据链方式排查：① 理解问题 → ② 读相关代码/知识 → ③ 查日志/数据（如果有工具） → ④ 给出结论和方案。用中文。`
    const result = await harness.run(prompt)
    return result.finalResponse
  } finally {
    await harness.close().catch(() => {})
  }
}
