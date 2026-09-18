# 创建需求前基线强制对齐 E2E 回归记录

- 日期：2026-09-18
- 执行者：Codex
- 代码 revision：`4bbec71` + 当前工作区修复
- Core 版本：`@codycodeagent/cody-web-core` 0.38.8
- 环境与 URL：本地 production build，`http://127.0.0.1:43329`
- 浏览器与视口：Codex in-app browser，1280×720
- SQLite 数据库：临时 `/tmp/codywork-baseline-e2e.nncPcK/runtime/workspace.db`
- 测试 Workspace：一次性 3 Repo Workspace（detached/落后、detached/落后且初始 dirty、已是最新）

## 结论

PASS。概览安全同步现在会将 detached 基线的本地默认分支和 checkout 一起安全快进；创建 Demand 前会获取远端默认分支、强制重建 `services/` 基线，再从对齐后的本地默认分支创建 Worktree。允许进入提交阶段。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 通过 UI 注册一次性 Workspace，仓库扫描完成后显示 3 个 Repo；服务重启后 Workspace 自动恢复。 | 健康接口返回 `ok`。 |
| E2E-002 | PASS | 概览正确显示两个 detached 仓库的远端默认分支 `main`，其中一个 dirty、一个 clean。 | 未把 detached 状态展示成默认分支。 |
| E2E-003 | PASS | 创建弹窗明确提示会更新并丢弃 `services/` 基线状态；通过 UI 从落后远端的 detached Repo 创建 Demand。 | 自动化集成测试另行覆盖 tracked/untracked 强制丢弃和已有 Worktree 保留。 |
| E2E-004 | PASS | 第二标签直接打开完整 Workspace/Demand/Conversation URL；刷新和服务重启后仍恢复同一 Demand、会话和消息。 | URL 身份完整。 |
| E2E-005 | PASS | 单仓库同步显示“已安全快进 1 个提交，并将基线切回 main”；文件系统确认 `HEAD = refs/heads/main = origin/main`。 | detached 同步不再只推进游离 HEAD。 |
| E2E-007 | PASS | Composer 发送 `BASELINE_ALIGNMENT_E2E`，页面仅显示一条用户消息并正常完成。 | 使用确定性 Runtime fixture。 |
| E2E-008 | PASS | 终态是一条用户消息、一条 `CODEX_FIXTURE_OK` 和一个 Worked 分隔；第二标签和重启后无重复或错序。 | 历史来源保持原生 Thread。 |
| E2E-011 | PASS | 两个标签均显示 Realtime connected；停服时进入 reconnecting，重启后恢复连接。 | 重连后消息与 Demand 状态保留。 |
| E2E-016 | PASS | 1280×720 页面无水平溢出，需求页、会话栏和 Composer 完整可见；两个标签 console 均无 error/warn。 | 服务端无未处理异常。 |

## 发现并修复的问题

1. 创建 Demand 直接从本地 `master/main` 创建 Worktree，既不 fetch，也不保证本地默认分支等于远端，导致新需求从旧提交开始。
2. 概览同步在 detached HEAD 下只推进 checkout，未推进 `refs/heads/master|main`，但页面仍报告成功；后续创建 Demand 继续使用旧分支。
3. 仓库发现把当前 checkout 分支误当成默认分支。现在优先使用 `origin/HEAD`，缺失时回退 `master/main`。
4. 创建 Demand 和向 Demand 添加 Repo 现在共用强制基线准备流程；先 fetch，随后清理 tracked/untracked 基线状态、切回并重置本地默认分支，再记录精确 `base_commit`。
5. 创建弹窗和添加 Repo 弹窗原文未披露基线清理行为，现已明确展示影响范围与已有 Demand Worktree 的保护边界。

## 未解决问题与阻塞

无。

## 健康检查

- `pnpm verify`：PASS；Server 25 文件 / 153 测试，Web 19 文件 / 67 测试，类型检查和 production build 通过。
- 浏览器 console error/warn：0。
- 服务端异常日志：0。
- 刷新/重连后的最终状态：Demand、会话、唯一用户消息与唯一 assistant 终态均恢复；两个基线和新 Worktree 的提交与远端默认分支一致。

## 清理

测试后关闭两个浏览器标签、停止本地服务，并移除一次性 Workspace、裸远端、updater、Demand Worktree、Runtime fixture state 与临时 SQLite。未修改真实用户仓库、正式数据库或飞书数据。
