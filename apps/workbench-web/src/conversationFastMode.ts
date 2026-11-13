import { reactive } from 'vue'

// 单会话和并行面板共享浏览器端偏好，会话 ID 用于隔离不同会话。
const choices = reactive(new Map<string, boolean>())
const keyPrefix = 'codywork:conversation-fast:'
const keyFor = (conversationId: string) => keyPrefix + conversationId

if (typeof window !== 'undefined') {
  // 另一个标签页修改同一会话时，已打开的输入区也要更新。
  window.addEventListener('storage', ({ key, newValue }) => {
    if (key?.startsWith(keyPrefix)) choices.set(key.slice(keyPrefix.length), newValue === '1')
  })
}

/** 读取浏览器保存的会话偏好，未设置时使用标准档。 */
export function isConversationFast(conversationId: string): boolean {
  const choice = choices.get(conversationId)
  if (choice !== undefined) return choice
  try { return window.localStorage.getItem(keyFor(conversationId)) === '1' } catch { return false }
}

/** 保存当前会话的选择。浏览器禁用存储时仍支持页面内切换。 */
export function setConversationFast(conversationId: string, enabled: boolean): void {
  choices.set(conversationId, enabled)
  try {
    if (enabled) window.localStorage.setItem(keyFor(conversationId), '1')
    else window.localStorage.removeItem(keyFor(conversationId))
  } catch { /* 浏览器禁用存储时保留内存选择。 */ }
}

/** 不支持 Fast 的模型显式清除覆盖，避免切换模型后沿用上一轮档位。 */
export function conversationServiceTier(conversationId: string, supportsFast: boolean): 'fast' | null {
  return supportsFast && isConversationFast(conversationId) ? 'fast' : null
}
