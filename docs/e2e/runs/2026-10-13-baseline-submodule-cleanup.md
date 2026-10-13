# 基线子模块清理回归

- 环境：本机 production build，127.0.0.1:43319，隔离 SQLite 与一次性 Workspace。
- Revision：5e0cc5d + 本次工作区修改；Core 0.43.1。
- 浏览器：Codex In-app Browser。
- 生产环境：仅前一轮只读诊断；本轮没有修改生产仓库或部署。

## 变更与结果

- 主仓库 reset 递归恢复已初始化子模块到 gitlink 记录的提交。
- 递归清理已初始化子模块的未跟踪文件；保留 ignored 文件和 worktrees/。
- 清理后检查真实 dirty 状态；残留变更返回 failed，前端保留弹窗显示原因。
- 临时仓库浏览器回归 PASS：概览 dirty → 清理确认 → clean，刷新后仍为 clean；Git status 为空。
- 残留变更浏览器回归 PASS：未跟踪的嵌套 Git 仓库保留，弹窗显示“清理后仓库仍有变更”，列表仍为 dirty。
- 浏览器控制台 error/warn：无。测试服务没有观察到未处理异常。
- 仓库自动化回归：8/8 PASS，包含子模块提交偏移、未提交改动、未跟踪文件和 Demand Worktree 保留。
- 后端完整测试：186/186 PASS（追加残留变更用例后，单独仓库测试 8/8 PASS）。
- 前端完整测试：81/81 PASS。类型检查、production build、git diff --check PASS。
- pnpm verify：BLOCKED，服务网络脚本在系统 Bash 3.2 报 entries[@]: unbound variable；其他步骤分别运行，结果如上。

## 覆盖范围

- E2E-002 仓库清理相关路径 PASS；E2E-001 Workspace 页面恢复、E2E-016 控制台检查为部分覆盖。
- 完整 P0 会话冒烟 E2E-004/007/008/011，以及 E2E-003/005：NOT RUN；本报告不把局部清理回归视作完整发布验收。
- 临时服务、SQLite、仓库、测试脚本和日志在验证后清理；生产数据保持原状。
