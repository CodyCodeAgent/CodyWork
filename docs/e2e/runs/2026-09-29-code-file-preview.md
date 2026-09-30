# CodyWork E2E 回归记录：Workspace 代码文件预览

- 日期：2026-09-29
- 执行者：NiceTrae
- 代码 revision：本地 `feature/codywork_trae_runtime` worktree，未提交、未推送
- Core 版本：本地 0.45.0 worktree
- 环境与 URL：本地生产构建，`http://127.0.0.1:3001`
- 浏览器与视口：BLOCKED（当前会话无浏览器自动化能力）
- SQLite 数据库：服务运行真实数据库；自动化测试使用一次性 Git 仓库
- 测试 Workspace：`mkdtemp` 创建并由测试清理

## 结论

本地 Markdown 中的常见源代码链接现在会发出可复用 `open-file` 交互，由 CodyWork 在 Workspace 边界内读取。预览弹窗提供“完整文件”和“变更 Diff”：后者只读比较当前工作区与 Git `HEAD`，未跟踪文件与空文件比较；不存在改动或不在 Git 仓库时不会展示伪造 Diff。Diff 可在传统上下布局与左右对照布局之间切换，并可按变更块分别控制上方、下方保留 0/3/10/20/50/100 行未修改上下文。

## 用例结果

补充：Diff 默认选中左右对照；预览弹窗右上角提供浏览器原生全屏按钮，按 Esc 或再次点击可退出。

| 用例 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 | BLOCKED | 3001 健康接口返回 HTTP 200。 | 无浏览器，不能验证页面启动/身份恢复。 |
| E2E-013 | BLOCKED | Core Markdown 单测验证本地 `.go` 链接转换为 `open-file`；服务端单测验证读取代码与 Diff。 | 无浏览器点击与弹窗可观察证据。 |
| E2E-014 | BLOCKED | 前端生产构建包含完整文件 / 变更 Diff、上下/左右布局、行号、Diff 样式和独立上下文控制。 | 无浏览器检验布局、滚动和颜色。 |
| E2E-016 | BLOCKED | 服务端、前端 production build 通过；启动日志无新增未处理异常。 | 无浏览器 console 和窄屏验证能力。 |

## 发现并修复的问题

- Core 原先只把 Markdown、JSON、YAML 等本地链接转换为产品控制的打开事件，`.go` 等代码链接仍会成为浏览器路径，导致无效路由。
- Core 扩展常见源码后缀到同一 `open-file` 交互；实际读取范围仍由产品控制。
- CodyWork 预览服务扩展常见源码与配置文件后缀，继续执行 `realpath` Workspace 包含性、普通文件、1 MiB 和 UTF-8 文本检查。
- 服务在文件所属 Git 仓库内以无 shell 的 `git diff --no-ext-diff --no-color` 生成有限大小 Diff；不读写 Git 状态。
- Diff 接口的 hunk 上下文可安全地在 0–100 行之间裁剪；页面一次请求上限 100 行原始上下文，再仅在已返回的 Diff 内容内分别裁剪每个 hunk 的上方、下方显示行数，不会增加 Workspace 读取范围。
- 左右对照模式把统一 Diff 解析为改动前 / 当前文件的对齐行；替换、纯删除和纯新增均使用不同配色，Hunk 与 Git 元数据跨两栏展示。

## 未解决问题与阻塞

- 无浏览器自动化能力，必须在真实页面确认的 E2E-001/013/014/016 记录为 BLOCKED，不能替代为接口或构建通过。
- `pnpm verify` 最终 build 阶段仍会被现有本地 Core `file:` 依赖的发布版本校验阻断；类型检查、服务端与前端全量测试、独立生产构建均通过。

## 健康检查

- Core：24 个测试文件、299 项通过；Core 与 Vue 构建通过。
- CodyWork：类型检查通过；服务端 27 个文件、170 项通过；前端 22 个文件、76 项通过；前后端 production build 通过。
- 3001：重启后健康接口 HTTP 200，返回 `ok` / `codywork`。
- 浏览器 console error/warn：BLOCKED（无浏览器能力）。

## 清理

- 代码预览测试创建的一次性 Git 仓库与目录由测试清理。
- 仅重启 3001 CodyWork 服务；重启前确认没有 `running` 或 `awaiting_approval` 会话。
- 未修改、删除真实业务仓库，未提交、未推送。
