import { describe, expect, it } from 'vitest'
import { buildConversationRecoveryPrompt, isThreadMigrationRecommended, recoveryConversationTitle } from './conversationRecovery'

describe('conversation recovery', () => {
  it('only migrates failures that cannot be repaired by retrying the same thread', () => {
    expect(isThreadMigrationRecommended('Codex 上游响应流恢复失败，未自动重发。 Reconnecting... 5/5')).toBe(true)
    expect(isThreadMigrationRecommended('websocket closed by server before response.completed')).toBe(true)
    expect(isThreadMigrationRecommended('network temporarily unavailable')).toBe(false)
  })

  it('builds a bounded continuation prompt from user and assistant text only', () => {
    const failed = { id: 'failed', role: 'user' as const, text: '继续完成最后的修复' }
    const prompt = buildConversationRecoveryPrompt([
      { id: 'user-1', role: 'user', text: '先检查问题' },
      { id: 'assistant-1', role: 'assistant', text: '我已经修改了一部分文件' },
      { id: 'system-1', role: 'system', text: '不应进入恢复上下文' },
      failed,
    ], failed, 1)
    expect(prompt).toContain('用户：先检查问题')
    expect(prompt).toContain('AI：我已经修改了一部分文件')
    expect(prompt).toContain('继续完成最后的修复')
    expect(prompt).toContain('1 张图片未能迁移')
    expect(prompt).not.toContain('不应进入恢复上下文')
  })

  it('keeps recovery titles within the conversation title limit', () => {
    const title = recoveryConversationTitle('x'.repeat(200))
    expect(title).toHaveLength(120)
    expect(title.endsWith(' · 恢复')).toBe(true)
  })
})
