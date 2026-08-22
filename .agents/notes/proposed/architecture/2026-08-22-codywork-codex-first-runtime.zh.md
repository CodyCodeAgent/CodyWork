# Agent Note: CodyWork 通过 Runtime Seam 只交付 Codex-first

状态：proposed

[English](2026-08-22-codywork-codex-first-runtime.md) | 中文

## 问题

同时暴露多个未完成 Runtime，会让 CodyWork 看起来可配置，实际却产生不一致行为、Fake Conversation 和 Provider 专属设置。产品需要先完成一条可靠的垂直链路，再承诺 Runtime 选择。

## 提案

CodyWork 只启用 Codex App Server。前端不提供 Provider Selector，服务端不回退 Fake Agent，Workspace 初始化与 Skill 安装都使用 Codex，数据库只保存 Codex 连接配置。现有 `ConversationRuntimeAdapter` 与标准事件模型继续作为内部 Seam，而不是用户可见的多 Provider 功能。

## 执行边界

CodyWork 编译 CSR Instructions 与 Effective Roots。Codex 通过 Base/Developer Instructions 接收上下文，通过 cwd、Runtime Roots、Sandbox Policy、Writable Roots 与 Approval Policy 接收权限边界。如果当前 App Server 无法执行所需边界，会话创建必须失败。Yolo 只会移除需求 Roots 内的审批。

## 兼容性

SQLite 迁移保留 Workspace、需求、Conversation、Event 与已保存的 Codex Command，只删除旧 Provider Credential 与选择字段。旧数据路径环境变量仍可使用，保证已有本机安装继续打开同一 Workspace 注册表。

## 验收标准

- CodyWork UI 与生产服务端路径不再引用其他 Runtime。
- Runtime 创建始终得到真实 `CodexRuntimeAdapter`。
- 连接测试执行真实 App Server Initialize 握手。
- 空 Workspace 由 Codex 初始化，再由 CodyWork 复检。
- Skills 只从 Codex 项目与用户 Roots 发现。
- 所有产品界面统一展示 CodyWork 品牌。
- Codex Adapter、Policy、Workspace、需求、Skills、Conversation、Build 与浏览器流程全部通过。

## 重新引入规则

只有新的 Runtime 实现同一协议、标准事件、恢复语义与精确 Root 执行，并提供同等约定证据后，才可以重新提案。即使接入成功，也不自动意味着 UI 必须出现 Provider Selector。
