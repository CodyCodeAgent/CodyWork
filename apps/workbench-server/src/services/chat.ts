/**
 * AI 会话层：交互式多轮对话。
 * 复用 dsh SDK 的 HarnessSession 能力——同一 sessionId 复用历史上下文。
 * 每个需求一个会话，上下文 = 该需求的 specs/ + worktrees/ + docs/。
 */

import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { launchArgs } from './ai.js'
import type { AiConfig } from './ai.js'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 把任意字符串转成 ASCII 安全的 session id 片段（中文 slug → 十六进制）。 */
function asciiKey(slug: string): string {
  return Buffer.from(slug, 'utf8').toString('hex').slice(0, 24)
}

/** 一个需求会话的持有态：sessionId + 消息历史（内存态）。 */
export interface ChatSession {
  id: string
  demandSlug: string
  messages: ChatMessage[]
  harness: DeepSeekHarness
}

/** 会话管理器：按需求 slug 复用会话。 */
export class ChatManager {  private sessions = new Map<string, ChatSession>()
  private cfg: AiConfig

  constructor(cfg: AiConfig) {
    this.cfg = cfg
  }

  /** 获取或创建某需求的会话。 */
  get(demandSlug: string): ChatSession {
    const existing = this.sessions.get(demandSlug)
    if (existing) return existing

    const harness = new DeepSeekHarness({
      launch: {
        ...launchArgs(this.cfg),
        env: { ...process.env },
      },
      cwd: this.cfg.cwd,
      provider: this.cfg.provider ?? 'deepseek-official',
      model: this.cfg.model ?? 'deepseek-v4-flash',
    })

    const session: ChatSession = {
      id: `demand-${asciiKey(demandSlug)}`,
      demandSlug,
      messages: [],
      harness,
    }
    this.sessions.set(demandSlug, session)
    return session
  }

  /**
   * 发送一条消息并返回 assistant 回复。
   * @param demandSlug - 需求 slug（会话键）
   * @param input - 用户消息
   * @returns assistant 回复文本
   */
  async chat(demandSlug: string, input: string): Promise<ChatMessage[]> {
    const session = this.get(demandSlug)
    session.messages.push({ role: 'user', content: input })

    const result = await session.harness.session(session.id).run(input)
    const reply = result.finalResponse || '（无回复）'
    session.messages.push({ role: 'assistant', content: reply })

    return session.messages
  }

  /** 列出某需求的完整消息历史。 */
  history(demandSlug: string): ChatMessage[] {
    return this.sessions.get(demandSlug)?.messages ?? []
  }

  /** 关闭所有会话并释放 dsh 子进程。 */
  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.harness.close().catch(() => {})
    }
    this.sessions.clear()
  }
}
