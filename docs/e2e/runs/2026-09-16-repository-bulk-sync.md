# 仓库主分支一键同步 E2E 回归记录

- 日期：2026-09-16
- 基线 revision：`33e8c35` + 当前工作区变更
- Core：`@codycodeagent/cody-web-core` 0.38.8
- 环境：本地 production build，隔离 SQLite、Workspace、3 个 Git Repo、2 个远端 Worktree
- 地址：`http://127.0.0.1:43292`

## 自动化验证

- `pnpm verify`：PASS
- Server：25 个测试文件、149 个测试通过
- Web：19 个测试文件、67 个测试通过
- TypeScript、Core 版本校验、production build：PASS
- 新增组件测试覆盖：批量同步入口、单仓库同步入口、运行进度、dirty 仓库禁用和逐仓库结果。

## 浏览器与 Git 回归

| 用例 | 结果 | 当前版本证据 |
| --- | --- | --- |
| E2E-001 页面启动与 Workspace 恢复 | PASS | production server 正常启动；服务重启后两个标签恢复连接和 Workspace/Demand 状态 |
| E2E-002 Workspace 与仓库发现 | PASS | 概览发现 3 个仓库，分支和 clean/dirty 状态与 Git 一致，刷新后保持 |
| E2E-003 创建多仓库 Demand | PASS | 从 UI 选择 `repo-current` 与 `repo-fast`，创建独立 Demand Worktree；两个 Repo 都位于 `repository-sync-demand` 分支且干净 |
| E2E-004 Demand URL 与刷新恢复 | PASS | 完整 Workspace/Demand/Conversation URL 在第二标签直达，历史恢复正常 |
| E2E-005 单仓库同步 | PASS | 对 `repo-current` 点击“同步”，页面显示“远端基线已是最新” |
| E2E-005 一键同步全部 | PASS | `repo-fast` 安全快进 1 个提交，`repo-current` 已最新，`repo-dirty` 因未提交文件跳过；汇总显示“更新 1，已是最新 1，跳过 1，失败 0” |
| E2E-005 安全边界 | PASS | `repo-fast/remote-update.md` 落地；`repo-dirty/local-only.md` 完整保留；未 reset、未 push、未改 Demand Worktree |
| E2E-007 用户消息即时状态 | PASS | `REPOSITORY_SYNC_PAUSE_E2E` 发送后立即可见，命令卡片显示 running，Composer 显示停止入口 |
| E2E-008 顺序与去重 | PASS | 连续三轮唯一消息各保留一条用户输入与一条 `CODEX_FIXTURE_OK` 终态 |
| E2E-011 多标签与重连 | PASS | 第二标签发送后第一标签实时同步；服务重启后双标签自动恢复 |
| E2E-016 宽窄布局与健康检查 | PASS | 桌面与约 820px 窄视口均无额外横向溢出；批量和单仓库按钮可见；浏览器 console 无 error/warn，服务端无异常日志 |

## 额外观察

- Fixture 长任务停止没有返回原生确认，页面按既有契约显示“Turn interruption could not be confirmed”并将会话标记为已断开；这不是本次仓库同步改动引入的问题。
- 批量同步逐仓库继续执行，单仓库阻塞不会中断后续项目。

## 清理

测试浏览器标签、production server、SQLite、裸远端、Workspace、Repo 和 Demand Worktree 均在回归结束后关闭或移入废纸篓；未触碰真实业务仓库。
