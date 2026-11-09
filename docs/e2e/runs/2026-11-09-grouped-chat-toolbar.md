# CodyWork E2E 回归记录：会话工具栏分组

- 日期：2026-11-09
- 执行者：Codex
- 代码 revision：`feat/responsive-workbench`，基于 `0e13ac4ebf12a551fe7616f48d5f95ee53ad317c` 的本地修改，叠加本轮前已有的桌面布局调整
- Core：v0.43.1，未修改
- 环境：本地产物，`http://127.0.0.1:43328/`；登录负例使用同一隔离服务的 `http://localhost:43328/`
- 浏览器：IAB；实测 1600×1000、1024×768、901×768、390×844、375×812、844×390
- 数据库：`/tmp/codywork-inbox-e2e.YkjTcg/fixture.db`；一次性 Workspace `ws_inbox`、Demand `demand_inbox`、会话 `conversation_inbox` / `conversation_other`

## 结论

本轮工具栏的分组、菜单和原功能入口已通过浏览器验证。没有提交、推送、合并或部署。下表 PASS 仅表示明确列出的验证范围；没有把局部覆盖视为完整产品用例通过。

- 连接与 Runtime 合为一个入口，切换 Runtime 与缓存入口在面板内。
- 定时跟进、工具箱和新会话保留直接入口；代码上报、分享和绑定归入更多操作。
- 桌面操作区单行排列；手机在详情抽屉中直接呈现全部操作，无嵌套弹出菜单。
- 悬停反馈 150ms、面板淡入并移动 4px，提供 reduced-motion CSS 关闭动效。未修改 Core 会话或权限状态。

## 用例结果

| 用例 / 本次验证范围 | 结果 | 当前证据 |
| --- | --- | --- |
| E2E-001 登录与恢复 | PASS | localhost 新登录入口错误密码明确报错，正确密码进入 `ws_inbox`；刷新后仍进入概览；深链接可读取历史，无再次登录 |
| E2E-004 深链接、刷新、前进后退 | PASS | 两 Tab 直接打开同一需求/会话，刷新恢复；概览与会话之间 back/forward，原 URL 和历史恢复 |
| E2E-007 正常发送、原位收敛、刷新 | PASS | `SLOW_E2E toolbar-review-1` 在回复前唯一显示并提示正在发送；完成和刷新后均一次；后续 review-2/3/4 各一次 |
| E2E-007 启动失败与重试边界 | NOT RUN | 本轮未改消息或 outbox 逻辑，未制造此负例；整条产品用例不计完整 PASS |
| E2E-008 四轮正常顺序和去重 | PASS | review-1 至 review-4 依次完成，相同 `CODEX_FIXTURE_OK` 回答保留各轮；刷新后六/七条历史回答与当时用户轮次一致，无重复新消息 |
| E2E-008 活跃工具与不同 overlay ID 全组合 | NOT RUN | 源会话含合成的已完成工具卡、表格和列表，未覆盖该用例所有活动工具分支；整条产品用例不计完整 PASS |
| E2E-011 多 Tab、断线与重启恢复 | PASS | Tab B 发 review-4，Tab A 不刷新收到一次；主动停止隔离服务后显示重连与第 5 次尝试，服务恢复后自动连接，刷新后 review-4 仍一次 |
| E2E-016 布局、焦点、健康 | PASS | 六种尺寸无文档横向溢出；901/1024/1600 桌面操作同排；375 手机抽屉内直接操作；Escape 退出并恢复入口焦点；最终浏览器 warn/error 为空 |
| 本轮菜单交互 | PASS | ArrowDown 打开 Runtime 面板并聚焦切换按钮；Escape 返回触发器；外部点击关闭；更多菜单可进入分享、代码上报和绑定弹窗，选项点击后菜单关闭 |
| 常用入口 | PASS | 工具箱直接打开；定时跟进打开设置页并预填 `conversation_inbox` 来源；未创建任务、绑定 Session、切换 Runtime 或发送外部消息 |
| 手机详情入口 | PASS | 375 与 390 手机详情按组展示 Runtime、跟进、工具箱、更多操作及新会话；内层按钮 Escape 不拦截外层抽屉关闭 |

## 发现并修复的问题

- 多个同权重描边按钮换行，缺少主次：减少常驻按钮数量，仅新会话使用紫色主按钮。
- 桌面/手机交互要求不同：同一操作插槽在桌面弹出、手机直接呈现，避免复制动作逻辑。
- 编写组件时检查到 unconditional Escape 会拦截手机抽屉退出：改为仅面板实际展开时处理 Escape，浏览器验证手机 Escape 正常。
- 菜单操作关闭不强制返回旧入口，避免抢走新弹窗焦点；Escape 关闭则恢复入口焦点。

## 未解决问题与阻塞

未发现本轮工具栏故障。E2E-007、008 的上述负例/组合仍未执行，不能宣称完整产品回归通过。Trae 缓存展示和 degraded 上报提示未用真实运行数据验证；组件降级/键盘/焦点/点击外部/断点切换有自动测试。系统级 reduced-motion 未在浏览器模拟，仅检查其 CSS 分支。真实模型、TEA 和飞书发送不在本轮执行范围。

## 健康检查

- `pnpm verify`：通过；服务端 254 + 前端 143 = 397 项，类型检查与生产构建通过。日志 `/tmp/codywork-toolbar-verify.log`。
- 浏览器最终 `warn/error`：空；断网是主动停止测试服务制造的验证步骤。
- 服务端：未观察到本轮异常，只有既有 SQLite experimental warning。
- `git diff --check`：通过。
- 截图：[单行工具栏](assets/2026-11-09-grouped-toolbar.png)、[更多菜单](assets/2026-11-09-grouped-toolbar-menu.png)、[手机详情](assets/2026-11-09-grouped-toolbar-mobile.png)。截图中的业务内容均为合成原生历史，非真实业务或模型执行结果。

## 清理

关闭三个临时浏览器 Tab、重置 viewport；停止隔离服务及原生 fixture 子进程；整个一次性目录（包括数据库、Workspace、Worktree 和合成状态）移回本机废纸篓。没有修改或清理真实用户 Workspace，没有外部消息、线上操作或真实凭据进入截图/报告。
