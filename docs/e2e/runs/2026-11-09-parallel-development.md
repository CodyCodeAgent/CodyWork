# CodyWork E2E 回归记录：工作空间并行开发

- 日期：2026-11-09
- 执行者：Codex
- 代码 revision：`0e13ac4ebf12a551fe7616f48d5f95ee53ad317c` + 本地工作区改动；分支 `feat/responsive-workbench`
- Core 版本：0.43.1，未修改 Core
- 环境：构建产物 + 独立 SQLite，`http://127.0.0.1:43328`
- 浏览器：真实 IAB；1600×1000、1280×900、1024×900、820×1000、390×844
- 数据库：`/tmp/codywork-parallel-e2e.Yu10O8/fixture.db`，验收后移入废纸篓
- Workspace：`ws_parallel` / `ws_other`，全部为一次性合成数据；两个本地 bare Git 远端，四个预置 Demand/八个真实会话绑定
- Runtime：可持久化 native Thread 历史的 JSON-RPC App Server fixture，经正式 Core runtime、Gateway、WebSocket、历史快照和 Vue controller 执行；没有真实模型调用，也没有外部通知发送

## 结论

并行开发的核心交互、状态隔离、配置持久化和恢复路径通过隔离环境浏览器验收。最终 `pnpm verify` 通过：服务端 259、前端 152，共 411 项；类型检查及构建通过。代码尚未提交或部署。

真实 provider 的 response-stream retry/fallback 没有可用测试环境；图片剪贴板/拖拽和完整 Git 异常矩阵也未执行，不能据此宣称全部端到端回归完成。以下明确区分完整用例与子用例。

## 用例结果

| 用例 | 结果 | 当前版本可观察证据与范围 |
| --- | --- | --- |
| E2E-001 | PASS | 错误口令有提示，正确口令进入；Workspace 切换和已保存布局恢复；实际深链接在登录后重新打开验证。 |
| E2E-003 核心创建路径 | PASS | Repo 搜索 alpha/beta 时保留多选，创建双仓库 Demand 后进入完整需求页；两个基线的本地修改被丢弃，HEAD 与 origin/main 对齐；旧 d1/d2 Worktree 的保留哨兵未变化。 |
| E2E-003 完整异常矩阵 | NOT RUN | 未重复执行远端不可用、重复点击和动态追加 Repo 的全部分支；生产 Git 实现本轮未改动。 |
| E2E-004 | PASS | 面板菜单跳转 `workspace=ws_parallel&demand=d1&conversation=c_d1_a`；新 Tab 直接打开、刷新和从概览后退恢复同一 Demand/真实历史。 |
| E2E-005 清理及 detached 同步 | PASS | 概览读取 dirty；清理前展示具体基线、丢弃范围及不修改 Worktree 的确认文案；确认后 beta clean，单仓库同步提示已切回 main；本地只读 Git 检查验证主分支及哨兵。 |
| E2E-005 完整批量矩阵 | NOT RUN | 本轮未执行批量同步与后台扫描并发、领先/分叉等全部分支；未修改同步代码。 |
| E2E-006 核心导航/会话管理 | PASS | 两级侧栏折叠/展开、需求和会话切换、新建真实会话、重命名后刷新、删除绑定确认；明确保留原生 Thread，返回并行页自动回退有效会话。 |
| E2E-007 | PASS | alpha/beta 两条 SLOW_E2E 在四秒回复前各有一个用户项；结束和刷新收敛为一份；启动失败显示显式重试而不自动执行。 |
| E2E-008 | PASS | 多轮唯一 prompt、工具卡片、重复内容的多轮 CODEX_FIXTURE_OK 各自保留；后续第四轮、刷新、跨标签实时及重启后没有重复 Turn。 |
| E2E-009 | PASS | Enter 换行、Control+Enter 发送；从 `$` 候选分别选择 fixture-skill/global-review，出现两个引用且历史回读可见；PAUSE_E2E 运行时第二条通过“加入队列”立即出现，停止前一条后下一条执行一次。 |
| E2E-010 | PASS | 两个 PAUSE 同时运行，只停止 d1 时 d2 继续；取消工具 + 可发送状态是等价停止终态；后续发送成功。单次 admission failure 通过显式重试执行一次。失败尝试记录沿用 Core 语义，产品未自行过滤 owner 历史。 |
| E2E-011 | PASS | 两个真实 Tab 同时连接；A 发送后 B 在回复前看到用户项；显式关闭隔离服务时四个面板变为“重连中”，重启后自动“已连接”、历史收敛，队列消息仅一条。 |
| E2E-012 App Server 退出子路径 | PASS | DISCONNECT 使原生进程以 23 退出；d4 失败并提供重试，其余面板浏览器仍“已连接”，执行数归零；没有自动重启或重发。显式重启服务后新消息成功。 |
| E2E-012 provider stream retry/fallback | BLOCKED | 无真实 provider；进程退出夹具不能冒充 response-stream retry/HTTPS fallback。 |
| E2E-013 文件选择/预览子路径 | PASS | 上传合成 PNG；切换 d2 会话隐藏图片，切回恢复；发送到 d2、原生历史回读后缩略图和大图预览可用，关闭预览成功。 |
| E2E-013 粘贴/拖拽/JPEG | NOT RUN | 本轮仅通过 file chooser 实际上传 PNG，没有执行其余输入方式。 |
| E2E-014 已影响的展示路径 | PASS | 多个 Core 实例同时显示工具、表格、白底 Mermaid；展开运行工具可见各自 Worktree；复制 CSV 得到当前表格；刷新后保留；无重复 DOM ID。 |
| E2E-016 | PASS | 桌面和 820px 下概览、需求列表、完整会话、知识库、Skills、设置及主要弹层可打开；390px 需求标签切换、独立草稿和展开设置可用；上述五种尺寸无页面级水平溢出；两个 Tab console error/warn 均为空。 |
| E2E-027 | PASS | 添加四个 Demand 后禁用添加；下拉仅列本需求会话；新建会话在完整页同样可见。草稿/PNG/权限/审批/问题/停止隔离；双列/四宫格/放大/返回。运行中的 d4 移除并重新添加仍 running，手动停止后可继续。两 Tab 修改布局出现版本冲突和未保存提示，重载恢复服务端版本；另一 Workspace 无旧面板；刷新、原生进程和服务重启后选中会话/布局恢复。删除选中绑定后回退有效会话。迟到请求及数据归属另外有自动化覆盖。 |

## 发现并处理的问题

1. 顶部小铃铛覆盖嵌套并行页的添加操作：为并行顶栏显式预留通知入口空间；手机重置并调整按钮间距，避免四个汉字被拆成两行。重新检查桌面和窄屏。
2. 创建会话期间旧的元数据请求迟到，可能覆盖新会话：使用请求 generation 丢弃旧响应；增加覆盖真实创建与迟到刷新先后顺序的测试。
3. 布局的保存确认不能覆盖保存期间的新选择：串行提交并只合入 revision；冲突保留未保存提示，显式重试/重新加载；自动化和双 Tab 浏览器均验证。
4. 原测试 native fixture 并发预约 Turn ID 时使用尚未递增的全局计数，两个请求会收到同一个 ID；中断也没有终态事件。修复夹具在 admission 时预约独立 sequence、按请求对应审批/问题，并发出正确中断终态；增加真实 runtime 适配器并发下一轮回归。早期由夹具造成的排队/中断隔离状态不计为产品通过证据，修复后重新运行。
5. 曾尝试用 Core 的 discardFailedUserMessage 清理重试前失败项，但 owner snapshot 会恢复该失败尝试。该额外改动已撤回，保持 Core 统一显式重试语义，没有增加第二份历史缓存或按文本去重。

## 健康检查与边界

- 最终检查日志：`/tmp/codywork-parallel-verify-final-ui.log`；411 tests、typecheck、build 通过，只有已有的 bundle 大小提示。
- `git diff --check` 通过；Core 依赖版本不变。
- 浏览器 error/warn：两 Tab 最终均 `[]`。
- 服务日志：故意杀死上游的场景产生一次智能通知无法读取已退出 owner 的预期错误；普通操作和恢复后无未处理异常或持续重试。
- 再次读取布局确认四个会话选择与 grid 持久化，后续双列修改也保存；刷新和重连后的队列唯一项计数为 1。
- 未修改生产服务器、真实 Git 远端、真实 Workspace；没有飞书消息、真实模型请求、commit/push/merge/tag/deploy。
- 草稿 Map 只保留未发送文字及图片，不缓存会话 transcript。刷新后不承诺恢复草稿；布局按 Workspace 共享，多页面冲突不会悄悄覆盖。

## 证据

- [双列](assets/2026-11-09-parallel-columns.png)
- [四宫格](assets/2026-11-09-parallel-desktop.png)
- [手机](assets/2026-11-09-parallel-mobile.png)
- [合成上游退出](assets/2026-11-09-parallel-upstream-failure.png)

## 清理

- 已停止 43328 的隔离服务及其 native 子进程。
- 一次性 SQLite、两个 Workspace、仓库/Worktree、合成上传图片、原生历史状态及启动脚本均移入用户废纸篓，可恢复；未清理真实仓库。
- 关闭本轮创建的验收 Tab 8/9，恢复临时视口设置；保留用户之前查看的 43340 原型页。
- 先前无效夹具的临时目录亦已移入废纸篓；没有用其结果替代最终断言。
