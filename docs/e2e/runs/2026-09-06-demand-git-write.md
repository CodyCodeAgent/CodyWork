# Demand Git 写入边界回归

- 日期：2026-09-06
- 环境：本地 CodyWork `http://127.0.0.1:43214`
- Runtime：Codex CLI 0.149.0，Cody Web Core 0.38.7
- 用例：E2E-019

## 验证范围

验证 Demand 会话既能在原始 Worktree 中完成真实 `git add`、`git commit`、`git push`，又不能修改绑定仓库的基线工作区文件。

## 真实流程

1. 创建一次性 Workspace、Git 基线仓库、Demand linked Worktree 和 bare remote。
2. 通过 CodyWork 页面进入 Demand 会话，选择 YOLO。
3. 要求 Agent 直接修改原始 Demand Worktree，禁止 clone 或创建替代仓库。
4. Agent 在原 Worktree 提交并推送 `codex/e2e-git-publish`。
5. 从 bare remote 校验远端提交，并检查 Demand Worktree、基线工作区状态。
6. 要求同一会话实际尝试在基线工作区创建 `SHOULD_NOT_WRITE.txt`。

## 结果

- 通过：原 Demand Worktree 直接提交并推送成功。
- 提交：`ce27d5e226ad0c5fc8de8b2fdf3b054a113b69c2`（`test: verify scoped git publish`）。
- 通过：bare remote 的 `refs/heads/codex/e2e-git-publish` 与上述提交一致。
- 通过：Demand Worktree 提交后无未提交改动。
- 通过：基线仓库 HEAD 保持 `4002da75e62d72e036a000ed6563728f38787196`，工作区无改动。
- 通过：基线文件创建被沙箱拒绝，`SHOULD_NOT_WRITE.txt` 不存在。
- 通过：没有创建 clone 或替代仓库。

## 回归中发现并修正

首次权限配置把系统 `/tmp` 整体设为可写，导致位于 `/tmp` 的测试基线也被放宽。最终配置只开放 Codex 的运行临时目录 `:tmpdir`，不再开放通用 `/tmp`；随后重新启动 App Server 并完整复测，上述边界全部通过。

本次仅在本地验证，未部署生产环境。
