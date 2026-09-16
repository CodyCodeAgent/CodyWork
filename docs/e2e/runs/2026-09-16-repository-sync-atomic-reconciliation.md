# 仓库同步原子扫描与 detached HEAD E2E 回归记录

- 日期：2026-09-16
- 执行者：Codex
- 代码 revision：`433f80c` + 当前工作区修复
- Core 版本：`@codycodeagent/cody-web-core` 0.38.8
- 环境与 URL：本地 production build，`http://127.0.0.1:43327`
- 浏览器与视口：Codex in-app browser 1280px；Chrome headless 820×1000
- SQLite 数据库：临时
- 测试 Workspace：一次性 4 Repo Workspace（落后、最新、dirty、detached HEAD）

## 结论

PASS。仓库发现结果改为原子发布后，后台扫描不再向同步接口暴露 `present = 0` 的半完成状态；批量同步只在整批结束后触发一次 Dashboard 刷新。detached HEAD 仓库能够从 `origin/HEAD` 识别 `main` 并安全快进。允许进入提交阶段。

## 用例结果

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | PASS | 从空状态通过 UI 注册一次性 Workspace；服务重启并刷新后 Workspace 自动恢复。 | 健康接口始终返回 `ok`。 |
| E2E-002 | PASS | 概览发现 4 个仓库；刷新和重启后仍为 4 个，数据库中全部为 `present = 1`。 | detached 仓库显示推断出的 `main`。 |
| E2E-003 | PASS | 通过 UI 选择 `repo-current`、`repo-detached` 创建双仓库 Demand。 | 两个 Worktree 均在独立分支且保持 clean。 |
| E2E-004 | PASS | 第二标签直接打开完整 Workspace/Demand/Conversation URL，重启与刷新后仍恢复原 Demand 和会话历史。 | 3 轮完成消息顺序稳定。 |
| E2E-005 | PASS | 单仓库显示“远端基线已是最新”；批量过程显示 `1/4` 和逐仓库状态；最终汇总“更新 2，已是最新 1，跳过 1，失败 0”。 | 全程未出现“Repo 不存在或已不在当前 Workspace 中”。 |
| E2E-005 detached HEAD | PASS | `repo-detached` 页面显示 `main`，安全快进 1 个提交；Git 仍保持 detached，HEAD 与远端一致。 | 未强制 checkout、reset 或 push。 |
| E2E-005 安全边界 | PASS | `repo-dirty` 的 staged 改动保留；两个 Demand Worktree 均 clean；基线同步未修改 Worktree。 | `repo-fast` 和 `repo-detached` 各前进 1 个提交。 |
| E2E-007 | PASS | `PAUSE_E2E ATOMIC_SYNC_RUNNING` 立即显示用户消息、运行中命令卡片、输出和停止入口。 | 使用确定性 Runtime fixture。 |
| E2E-008 | PASS | 三个完成 Turn 均各有一条用户消息和一条 `CODEX_FIXTURE_OK`；第二标签和重启后无重复、错序。 | 终态收敛正常。 |
| E2E-011 | PASS | 第二标签发送后第一标签实时出现同一 Turn；服务停止时双标签进入重连，服务恢复并刷新后双标签重新连接。 | 历史持久化恢复。 |
| E2E-016 | PASS | 1280px 无水平溢出；820×1000 真实 Chrome 截图中概览、仓库列表和操作按钮完整可见；页面 console 无 error/warn，服务端无未处理异常。 | 状态同时以文字和颜色表达。 |

## 发现并修复的问题

1. 后台扫描先把全部仓库设为 absent，再逐个恢复，批量同步会读到中间状态。修复为：先完成全部 Git 检查，再在单个 SQLite 事务中发布扫描结果；异常时整体回滚。
2. 批量同步每个仓库都会触发 Dashboard 扫描。修复为：批量请求携带 `refresh=0`，整批结束后仅刷新一次。
3. detached HEAD 被永久显示为 `HEAD`，无法同步。修复为：优先读取 `origin/HEAD`，缺失时依次回退 `master`、`main`，并继续遵守 dirty、ahead、diverged 和 fast-forward-only 边界。

## 未解决问题与阻塞

无。本轮 fixture 的暂停 Turn 在主动停止后显示既有的“interruption could not be confirmed”，不属于仓库同步改动；完成 Turn、重连和历史恢复不受影响。

## 健康检查

- `pnpm verify`：PASS；Server 25 文件 / 151 测试，Web 19 文件 / 67 测试，类型检查和 production build 通过。
- 浏览器 console error/warn：0。
- 服务端异常日志：0。
- 刷新/重连后的最终状态：4 个仓库持续可见；2 个快进成功、1 个最新、1 个 dirty 安全跳过；会话历史和双标签连接恢复。

## 清理

测试完成后关闭两个浏览器标签和本地 production server；一次性 Workspace、裸远端、updater、Demand Worktree、Runtime state、SQLite 与窄视口截图全部移入系统废纸篓。未修改真实用户仓库、正式数据库或飞书数据。
