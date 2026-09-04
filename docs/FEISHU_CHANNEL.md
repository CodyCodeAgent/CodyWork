# CodyWork 飞书通道

CodyWork 内嵌一个 Channel Host。它把飞书消息接入现有的 Workspace → Demand → Conversation，而不是建立一套独立聊天系统。

## 权威边界

- 原生 Codex Thread 是消息历史和 Turn 生命周期的唯一权威。
- `@codycodeagent/cody-web-core/channel` 负责 Inbox/Outbox 契约、稳定命令身份、租约重试和 Turn 投影。
- `@codycodeagent/cody-web-core/feishu` 只负责飞书长连接、事件归一化、卡片/消息/资源传输和错误分类。
- CodyWork 负责账号策略、Workspace/Demand/Conversation 选择、绑定、凭证密文和管理 UI。
- SQLite 的 `channel_*` 表只保存接入、投递、绑定和展示状态，不缓存 Codex transcript。
- CodyWeb 本阶段继续使用自己的飞书实现，不引用本通道，也不随本功能发布。

## 消息路径

1. 飞书事件先按 provider/account/event 唯一键写入 `channel_inbox`。
2. 默认拒绝策略检查发送人、群白名单、@语义和机器人身份。
3. 未绑定会话通过飞书卡片依次选择 Workspace、Demand、现有会话或新会话；首条消息持续保留。
4. 绑定后用稳定 `clientCommandId` 调用 CodyWork 的 `ConversationService.send`，复用浏览器正在使用的同一个 Runtime owner 和原生 Thread。
5. Core reducer 将同一事件流投影成飞书卡片；卡片 revision、远端 message ID 和终态只作为 presentation 数据保存。
6. 所有出站消息先进入 `channel_outbox`，再通过带租约的 worker 投递；可重试错误指数退避，永久错误进入死信。

## 恢复语义

- 飞书 SDK 长连接自行重连；终态断开后 Channel Host 延迟重建 provider，不重启 Codex App Server。
- 已取得原生 Turn ID 的消息在服务重启后从 Thread 历史恢复投影。
- 还未进入提交阶段的消息可安全继续。
- 已标记 `submitting` 但没有 Turn ID 的消息属于结果不确定，必须失败并提示 `/retry`，绝不静默重发。
- Outbox 的相同 dedupe key 只投递一次；同一卡片仅允许更高 revision 覆盖较低 revision。

## 配置与安全

- App Secret 使用 AES-256-GCM 加密，密钥保存在部署 `.runtime/channel-credentials.key` 或由 `CODYWORK_CHANNEL_KEY` 注入。
- API 和 UI 只暴露 `appSecretConfigured`，更新时 Secret 留空即保留原值。
- 私聊默认按整个 chat 绑定；可切换为按根消息隔离。
- 用户默认拒绝；启用前必须配置允许用户，或显式选择允许所有用户。
- 群聊默认全部拒绝，只有配置的 chat ID 可进入；默认每条消息必须 @机器人。
- 附件只写到 Demand `docs/.channel-attachments/`，文件名经过清理并限制大小。

## 飞书开放平台

应用需要机器人能力、消息读写和资源权限；事件订阅使用长连接并订阅 `im.message.receive_v1`；卡片回调同样通过长连接接收 `card.action.trigger`。完成配置后必须发布应用版本，未发布的权限或订阅不会对租户生效。
