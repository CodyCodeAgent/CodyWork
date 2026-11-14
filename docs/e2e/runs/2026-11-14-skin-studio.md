# CodyWork E2E 回归记录：皮肤工作台

- 日期：2026-11-14
- 执行者：Codex
- Revision：`f6a729f9d338326462390dbc3864bb8291214475` + `codex/workbench-skin-studio` 未提交改动
- Core：`@codycodeagent/cody-web-core` v0.43.1（未修改 Core）
- 环境：生产构建，`http://127.0.0.1:43470`，独立临时 SQLite 和合成 Workspace
- 浏览器：真实 Chromium / in-app browser，1440×1000、1280×720、820×1180、375×812
- 数据目录：`/tmp/codywork-skin-review`；两个一次性 Git 仓库 alpha / beta，后者带合成未跟踪文件
- Runtime：仓库 `tests/fixtures/codex-runtime.mjs` 的临时副本，补充合成 Markdown 响应和可持久化的工具完成事件；不调用真实模型，不发送外部消息

## 需求逐项核对

| 需求 | 实现 | 当前证据 |
| --- | --- | --- |
| 复用 CodyWeb 皮肤配置 | Skin API v1/v2 解析、variants、recipes、assets，Work 语义变量适配 | 解析/迁移/往返测试；真实 UI 导入 JSON，非法 JSON 显示错误且保留当前皮肤 |
| 保留原有三套主题 | 清爽专业、深色科技、松林手记，保留每个原有语义角色 | 角色一致性测试；逐一切换，概览/知识库/会话实测 |
| QQ 2007 内置 | 蓝银窗框、经典导航、立体控件、会话边线、惰性头像，双明暗模式 | 桌面及手机截图，深浅色和跟随系统选择、恢复默认 |
| 图片生成皮肤 | 浏览器本地取色、压缩背景，生成双模式，可调模糊/遮罩/饱和度/位置 | 上传合成 PNG、预览、命名、调整、保存应用；背景实际显示 |
| 导入导出 | 自包含 `.cody-skin`，JSON 编辑，重名副本，自定义皮肤确认删除 | 下载→删除→刷新确认消失→文件导入恢复；QQ 头像自包含自动测试 |
| 适配 CodyWork 页面 | 导航、概览、需求、会话、并行面板、设置、文档/Skill、弹层与 Composer | 页面遍历、图片预览、表格/代码/Mermaid、响应式检查 |
| 保存与错误处理 | 浏览器快照、旧主题迁移、多标签同步、存储失败提示 | 刷新与跨标签同步；配额失败/损坏存档自动测试；非法图片与包 UI 反馈 |

## 浏览器用例与范围

下表记录本轮实际执行的断言，不将外观相关子流程冒充整套业务回归。协议夹具验证浏览器、服务与原生历史接口的集成，不证明真实模型的语义判断。

| 用例/子流程 | 结果 | 观察证据 |
| --- | --- | --- |
| E2E-001 启动、认证、Workspace 恢复 | PASS | 错误密码有错误；正确测试密码进入；刷新/新标签保持 Workspace；打开会话后已连接 |
| E2E-004 Demand URL、会话与刷新 | PASS | 直接 URL 新标签恢复；两个真实产品会话可选；概览后退恢复选中会话；刷新保留历史 |
| E2E-007 立即发送、收敛、启动失败 | PASS | 延迟响应前用户文本立即出现；终态/刷新只有一份；主动构造夹具拒绝后显示失败及“重试此消息”，未自动重发 |
| E2E-008 普通多轮顺序与去重 | PASS | 五轮唯一用户文本、相同 assistant 回答各自保留、Worked 顺序正常；刷新/另一标签无重复 |
| E2E-008 工具终态的持久历史 | PASS | 补充临时夹具工具历史后，连续三轮 `SKIN_TOOL_COMPLETE round1/2/3` 均为用户→工具→回复→Worked；刷新保留三份独立工具/相同回答，手动展开输出正确；第四轮追加正常。停止分支另行验证 running→cancelled |
| E2E-011 多标签与重连 | PASS | 双标签会话及主题同步；本地服务停止/重启后浏览器自动重连，历史无重复、未自动重发 |
| E2E-016 布局与健康检查 | PASS | 概览、需求列表、会话、文档、Skills、设置、主要弹层；1440/1280/820/375 无页面水平溢出；Escape 关闭抽屉并还原焦点 |
| E2E-013 图片相关外观子流程 | PASS | 文件选择器加入 PNG、处理反馈、带文字发送、点击大图、Escape 关闭、刷新保留；本轮不覆盖粘贴/拖入/JPEG 全路径 |
| E2E-014 富文本与工具外观子流程 | PASS | GFM 表格、TS 代码、Mermaid 图；CSV 复制内容精确；深色图片皮肤下 Mermaid 画布仍为白色；工具运行展开、停止折叠 |
| E2E-017 快捷指令设置与执行子流程 | PASS | UI 创建两 Skill 指令→刷新保留→设置数量 1→工具箱点击→结构化 Skill 芯片与 Prompt 发送；AI 自然语言创建/队列业务未重跑 |
| E2E-018 Skill 失效业务 | NOT RUN | 未修改 Skill 解析、引用或有效性逻辑；仅检查 Skills 列表及详情外观 |
| E2E-027 并行页面外观子流程 | PASS | 添加现有需求、真实会话历史显示、两列/三列/四宫格切换、刷新保存、放大/退出；多需求并行执行/拖拽未重跑 |
| 皮肤专项完整流程 | PASS | 四内置、图片生成、预览与保存、导出/删除/重导入、跨标签、刷新、模式/密度/恢复、非法输入错误、手机布局 |

## 修复与复验

1. QQ 配色对比度修正原先会把强调色变黑：改为向黑/白混合并保留色相，实际 QQ 页面为蓝色控件。
2. 没有图片的预览也叠加遮罩：无背景时遮罩为零，四内置预览可读。
3. Demand/chat-scroll 实色背景挡住壁纸：背景配方下改透明，正文保留独立可读面板。
4. 不含头像素材的皮肤不能隐藏默认身份文字：仅对应素材存在时启用头像样式。
5. 深色模式强调色输入显示浅色默认值：改为使用当前 resolved variant。

以上修复均包含在最终 `pnpm verify` 和随后浏览器验证中。

## 自动检查与健康状态

- `pnpm verify`：退出码 0；Server 35 文件 / 263 测试，Web 42 文件 / 198 测试；类型检查、网络脚本检查、生产构建通过。
- `git diff --check`：通过。
- 两个浏览器标签 error/warn 查询均为空。
- 服务端仅有 SQLite experimental warning 和正常启动记录，无未处理异常或重试风暴。
- 另行注入的 `invalid current Codex sandbox policy` 是负向测试的预期响应，不是本次产品缺陷。
- 真实 Codex 模型、飞书外部投递未运行；皮肤不改变这些协议和服务。工具历史专项已补验；不宣称未涉及的全量业务 E2E 已通过。

## 截图

- [内置皮肤与自定义画廊](assets/2026-11-14-skin-studio/skin-gallery.jpg)
- [QQ 需求会话](assets/2026-11-14-skin-studio/qq-conversation.jpg)
- [图片皮肤会话](assets/2026-11-14-skin-studio/image-conversation.jpg)
- [图片皮肤富文本](assets/2026-11-14-skin-studio/rich-message-image-skin.jpg)
- [手机皮肤画廊](assets/2026-11-14-skin-studio/mobile-skin-gallery.jpg)
- [手机 QQ 会话](assets/2026-11-14-skin-studio/qq-mobile-conversation.jpg)

## 清理与交付

测试服务及其 fixture 子进程已停止，测试标签关闭、临时 viewport 恢复；临时 Workspace/Worktree/裸仓库/SQLite/上传图片/导出下载文件统一清理。保留上述脱敏截图及本报告。未修改真实用户 Workspace，未提交、推送、合并或部署。

使用入口与格式说明：[WORKBENCH_SKINS.md](../../WORKBENCH_SKINS.md)。
