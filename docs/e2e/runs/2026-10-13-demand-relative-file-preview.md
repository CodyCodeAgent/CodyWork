# Demand 相对路径预览

- 环境：本地隔离 production build，127.0.0.1:43321；临时 SQLite、一次性 Workspace 与 Demand。
- Revision：7a10e45 + 当前修改；Core 0.43.1。
- 修复：预览接口传递 Demand 根目录；相对链接先以该目录解析，再解析 Demand 仓库路径；不再回退到 Workspace 同名基线文件。
- 缺失文件错误包含实际查找路径；绝对路径继续使用现有 Workspace realpath 校验。
- 自动化：6 项文件预览测试通过，包含 docs/specs 同名文件、基线禁止回退、Workspace 会话、仓库路径、歧义路径和现有安全校验；类型检查、production build、diff check 通过。
- 浏览器：需求 URL 的 specs/report.md 打开 Demand report，显示 worktrees/demo/specs/report.md；刷新后保持一致，Workspace 同名 Baseline report 未被打开。console error/warn 为空。
- E2E-004 需求 URL 与刷新恢复：预览相关路径 PASS；E2E-013 文件链接预览 PASS；E2E-016 控制台检查 PASS（局部）。
- 完整 P0 会话发送、多 Tab、需求创建冒烟：NOT RUN。本次局部验证不等同于完整发布验收。
- 后端完整自动化 188/188 PASS，前端完整自动化 81/81 PASS。pnpm verify 被本机 Bash 3.2 服务网络测试的 entries[@]: unbound variable 兼容问题阻断；类型检查、前端测试、构建已分别通过。
- 测试后停止临时服务，关闭页面，将临时 Workspace 与 SQLite 移入废纸篓；生产数据未修改。
