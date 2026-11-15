# CodyWork E2E：顶部收起与并行快速设置

- 日期：2026-11-15
- 执行者：Codex
- Revision：2247fab + codex/collapsible-chat-header 工作区变更
- Core：v0.45.0，未修改 Core 或其补丁
- 环境：http://127.0.0.1:43471；生产构建、隔离 SQLite、安全原生协议 fixture
- 浏览器：IAB；1280×720、1440×900、1000×850、820×900
- Workspace：`/tmp/cody-compact-e2e-vqrxNA/workspace`，4 个独立 Worktree，各 2 个真实会话记录
- 数据库：`/tmp/cody-compact-e2e-vqrxNA/db.sqlite`

## 结论

本次两个界面行为验收通过：顶部折叠、刷新恢复及操作入口可用；并行面板的快速模式随设置展开，保持原有会话隔离和持久化。尚未提交或部署。

## 用例结果与范围

下表为本轮 P0 冒烟及受影响交互的实际覆盖，不代表整套用例的全部分支回归。

| 用例 | 结果 | 当前证据 |
| --- | --- | --- |
| E2E-001 冒烟 | PASS | 错误密码提示；正确登录；刷新和第二个 Tab 恢复 Workspace、会话及连接 |
| E2E-004 | PASS | Demand/conversation 专属 URL 直接打开、刷新恢复，概览与会话前进/后退恢复历史 |
| E2E-007 正常发送冒烟 | PASS | SLOW_E2E 首轮在回复前出现唯一用户消息；双 Tab 同步，结束和刷新不重复 |
| E2E-008 顺序冒烟 | PASS | 已有含工具的历史和 4 轮新增问答顺序稳定；相同 fixture 回复按轮保留，刷新无重复 |
| E2E-011 重连冒烟 | PASS | 临时启动器调用现有 closeRealtime(1012) 强制断开浏览器连接；双 Tab 自动恢复且历史未重复；随后发送成功 |
| E2E-016 布局冒烟 | PASS | 概览、知识库、Skills、设置、会话页；工具箱、键盘切换；桌面/窄屏无页面水平溢出，无 console error/warn |
| E2E-027 受影响设置交互 | PASS | 两个面板各自发送并收到回复；设置关闭时无快速按钮，展开后可切换；其他面板和同需求其他会话不受影响；切回及刷新保留快速选择；两列/三列/四宫格和平板设置可用 |

专项观察：

- 1280px 视口，展开头部约 190.8px，收起后 64px；1440px 保留文字操作，较窄桌面显示有可访问标签的图标操作。
- 顶部展开/收起不清空输入草稿；Enter 可切换；收起后工具箱可正常打开，展开恢复 Worktree 路径。
- 桌面收起偏好不会隐藏移动端「会话详情与操作」抽屉的需求信息。
- 快速模式开启后收起设置，隐藏按钮的 aria-pressed 仍为 true；其他需求和同需求另一会话为 false。刷新并展开设置后仍为 true。
- 先使用不声明 Fast 的原 fixture 验证不出现快速按钮，再使用临时副本声明 `serviceTiers: [{ id: 'fast' }]` 验证显示与选择。未修改仓库 fixture。
- 服务重启后并行布局及真实历史恢复。未连接真实模型或外部消息渠道。

## 范围限制

本轮没有完整重跑 E2E-027 的拖拽、审批、图片、删除、跨 Workspace 冲突分支；未重跑 E2E-007 admission 失败重试分支。这些逻辑未修改，本报告只将上述实际覆盖的冒烟/交互记为 PASS，不声称完整端到端套件通过。

## 健康检查与证据

- `pnpm verify`：PASS；264 server + 198 web 测试，类型检查及构建通过。保留已有 bundle 大小提示。
- `git diff --check`：PASS。
- 浏览器两 Tab：console error/warn 均为空。
- 服务端：仅启动信息及 Node SQLite 实验性提示，无未处理异常。
- 截图：`/Users/bytedance/.codex/visualizations/2026/11/15/codywork-header/collapsed.jpg`
- 设置截图：`/Users/bytedance/.codex/visualizations/2026/11/15/codywork-header/parallel-settings.jpg`
- 自动检查日志：`/tmp/cody-header-verify.log`；服务日志：`/tmp/cody-header-server.log`。

## 清理

已关闭两个测试 Tab，恢复视口，停止临时服务及 Runtime，删除隔离 Workspace、4 个 Worktree、数据库和临时启动器/fixture 副本。未修改正式环境或真实业务仓库。
