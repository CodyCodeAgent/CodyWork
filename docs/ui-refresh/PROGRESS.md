# CodyWork UI/UX 与主题重构

## 范围与约束
- 基线 main d1cb439；分支 codex/workbench-theme-system。原工作区干净。
- 产品：面向开发者的 AI 研发工作台。保留真实 API、原生会话、权限和业务状态；不部署生产。
- 技术：Vue 3 / Vite / TypeScript；Core 0.43.1（已有 Fast 补丁）。
- 默认「清爽专业」冷白与墨蓝；「深色科技」层次深蓝与青色；「松林手记」暖纸与松绿。
- 字体使用系统中文与等宽字体，不增加外部字体请求。动效只用于交互反馈，支持 reduced-motion。

## 当前状态

本地 UI 交付审计已完成，未提交或部署。以 [FINAL_AUDIT.md](FINAL_AUDIT.md) 和 E2E 报告顶部汇总为准；下方轮次是历史过程，不代表仍有活跃测试进程。已停止并清理隔离服务、DB与工作区，保留截图和日志。全量业务 E2E 的未验证与基线缺陷没有改写为通过。

## 验收矩阵（2026-11-14 更新）
实现与验收分别记录；「部分」不能作为完整用例通过。

| 页面/流程 | 实现 | 浏览器验收 | 遗留 |
|---|---|---|---|
| 公共导航、主题切换、持久化 | 已实现 | 三主题设置切换/刷新/跨Tab、375导航已验 | 无已知展示遗留 |
| 工作区概览、仓库列表 | 已实现 | 桌面空态/3仓库状态已验 | 第十三轮已补全安全同步/分叉/detached/失败继续/需求文件保留，E2E-005 PASS |
| 工作区创建、目录选择、仓库管理 | 已实现 | 创建及嵌套焦点、AddRepo复测已验 | 登记/扫描/移除已验；仓库搜索指南入口差异单列 |
| 需求列表、创建需求、添加仓库 | 已实现 | 四需求真实创建/长路径/375与1440列表头部、添加仓库已验 | 创建失败不留半成品、第三Repo搜索已验；一次性Workspace最终清理已执行 |
| 需求会话、Workspace会话、工具栏、输入区 | 已实现 | 原生协议多回合/刷新/双Tab部分已验 | 真实Workspace三模式、Git本地bare推送/重启/删除最后会话已验；短屏空态1280×720/375×720修复复测通过 |
| 并行开发、布局与拖拽、会话切换 | 已实现 | 双面板/键盘排序/草稿身份/手机已验 | 四面板/三布局/双任务/草稿附件身份/多Tab冲突已验；中途Escape与边缘悬停受工具限制，详见报告 |
| 知识库、文档预览、文件预览 | 已实现 | 清爽/深色/松林代表页，选择/无结果、需求文件预览与全屏已验 | 真实文档沉淀及新会话继承已验（E2E-015 PASS） |
| Skills、安装执行弹窗 | 已实现 | 列表/搜索/选中态、安装121秒完成/暂停与键盘焦点已验 | 真实安装触发Codex .agents只读限制，未成功落盘；已验证真实暂停 |
| 设置总览、Runtime | 已实现 | 三主题/375/820/1440及真实Runtime连接已验 | 截图已保存查看，无已知展示遗留 |
| 快捷指令、定时跟进 | 已实现 | 指令创建；跟进创建/编辑/暂停/执行/完成 | 快捷指令E2E-017/018通过；三通知频率四轮与重启已验；取消确认/待处理结果已验；外部投递及精确竞态未完整验证 |
| 飞书机器人、智能通知 | 已实现 | 合成站内通知、飞书设置820部分 | 820/375表单完整滚动已复测；外发未授权 |
| 通知中心、分享、绑定、代码上报、工具箱 | 已实现 | 站内通知/筛选/已读/深链接已验 | 主要弹窗已实际查看；外部飞书与TEA无测试身份/外发授权 |
| 375/820/1440 三主题、键盘、减少动态 | 已实现 | 代表页与焦点已验；减少动态CSS已实现 | 当前浏览器工具无媒体偏好模拟接口，真实系统减少动态效果未验证 |

## 当前证据与环境
- 已阅读 AGENTS.md、E2E指南、ui-ux-pro-max。历史步骤保留在下方，各轮PID是当时记录，不代表现存进程。
- 隔离生产API43351，临时DB /tmp/codywork-theme-review/workspace.db；Workspace ws_mwfwy9nx_89qfil，路径 /tmp/codywork-theme-review/workspace。
- 2026-11-14第十二轮核实API PID49007/43351、Vite25422/43352、WS测试代理45106/43354存活；浏览器2/tab16。为测试目录失效，前一轮在无任务运行时有意重启隔离API并从夹具Skill目录移除global-review；不是因观察超时而重启。恢复时仍须先核实进程。
- 测试Runtime为有状态原生协议夹具，不执行真实模型命令或外发，不替代真实provider认证/送达验收。
- 当前进度详见 [浏览器记录](../e2e/runs/2026-11-14-theme-system.md)；主题说明和启动方式见 [README](README.md)。

## 交付
1. 本次范围的展示修复与受影响浏览器复测已结束。
2. 最后工程检查263+179通过；启动、主题、前后截图与限制见README/FINAL_AUDIT。
3. 不自行提交或部署；其余跨服务与工具限制作为明确未验证项保留。

## 第一轮基础实现（进行中）
- theme.ts：三主题选择、存储失败降级、跨标签同步；index.html：首屏初始化；ThemePicker：设置页入口。
- themes.css：语义颜色/表面/边框/文字/状态/阴影/圆角/间距/动效；概览和导航第一轮适配。
- 自动化：服务端263项通过；前端167项通过（含4项新增主题测试）；类型检查与生产构建通过。已有bundle大小提示。
- 首次测试因Node25暴露的localStorage不是浏览器Storage失败，测试改用可控Storage替身；真实浏览器刷新持久化另行确认通过。
- 浏览器：1440×1000设置页切深色并刷新后仍选中。已查看截图 settings-midnight-in-progress.jpg。
- 发现并修复：设置图标 scoped 样式覆盖语义颜色导致部分图标白底，已将该组件颜色迁移到变量，待浏览器复测。
- 全部主要页面、三尺寸/三主题、P0仍未验收，不能计作任务完成。下一轮继续样式迁移与代表页复测。
- 日志：/tmp/codywork-theme-review/{verify,web-tests,build}.log；服务72154与64813保持运行用于继续开发，最终需清理。浏览器tab3已保留，视口覆盖已重置。

## 第二轮迁移与真实页面检查（进行中）
- 已将主样式、响应式、并行布局及17处组件样式的颜色迁移到语义变量；Core 嵌入会话通过 conversation-theme.css 适配，不改消息状态机。
- 三主题增加文字对比度测试；实际发现松林主题导航次要文字不足4.5:1，已调整并通过。主题与对比度共7项通过。
- pnpm verify 第二轮通过（服务端263、前端167、类型检查及构建）；对比度测试和后续小修复在本次检查后新增，仍需最终重跑。
- 浏览器1440：三主题设置页切换与刷新保留；Runtime/日志展开；智能通知创建站内测试通知、通知抽屉、标记已读和刷新保留。
- 浏览器375：移动导航开关、导航选择后关闭并恢复焦点、通知抽屉、设置页完整滚动；设置页 scrollWidth=375，无横向溢出。820：松林设置布局已查看。
- 已保存并查看 settings-midnight-migrated.jpg、settings-forest-migrated.jpg、overview-professional-in-progress.jpg（后者为空仓库状态）。这不是全矩阵验收。
- 发现并修复：Runtime与需求状态标签文字/底色相同、概览空列表贴边、侧栏长需求名称挤压状态。侧栏修复待复测。
- 准备三个真实临时Git仓库（一个dirty），本地bare origin，不接触业务仓库。UI刷新扫描显示3仓库/1文档。
- UI创建「任务中心 · 状态与通知体验」，选择两仓库；demand_mwfxy1rh_kzmv15 / conversation_mwfxy1ui_4esvsk。发送延迟原生协议fixture：立即单条用户消息，结束后单条回复CODEX_FIXTURE_OK；刷新恢复待复核。
- 临时Runtime扩展只位于 /tmp，补充账户/额度RPC，避免旧fixture未实现的超时；API现PID73262/session61261，Web PID25422/session64813。恢复需重新核对存活。
- 本轮发现自定义弹窗没有完整键盘范围，正在补公共 v-modal-focus：初始焦点、Tab循环、嵌套弹窗、Esc遵循业务关闭守卫、恢复触发按钮；同时关联创建需求/工作区字段标签，收紧弹窗表单间距。
- 下一步：验证焦点修复与侧栏；继续所有主页面、复杂会话、并行开发和P0生产构建验收。不要把样式迁移视为全部验收通过。

## 第三轮：公共交互与生产构建（已实现，验收继续）
- v-modal-focus 已覆盖产品自定义弹窗，新增3项测试：焦点范围/Tab循环、嵌套Esc与恢复、业务busy守卫及卸载清理；原生dialog保持自带焦点行为。
- UI复测创建需求、创建Workspace和嵌套目录选择：初始焦点、正反Tab、Esc逐级关闭与恢复通过。创建需求宽度、长仓库路径和字段标签已修正；侧栏长标题不再挤出状态。
- 登录页复用同一份 theme-tokens.css，服务启动时内联到认证页；未扩大公开路由。375深色下错误提示、正确登录和无横向溢出已验证。
- pnpm verify 第三轮通过：server263、web173（含4主题/3对比度/3焦点）、类型检查和生产构建。日志 /tmp/codywork-theme-review/verify-login.log；已有大bundle提示。
- 生产构建43351使用隔离DB和有状态原生协议fixture。4回合、工具记录、Markdown表格/代码/Mermaid、刷新和双标签同步均观察到无重复消息。fixture没有执行真实命令/外发，也不代表真实模型认证或推理验收。
- 证据已查看并保存：assets/conversation-midnight-tools.jpg、assets/login-midnight-mobile.jpg。
- 375会话输入设置发现等宽字体挤压选项，已调整为系统正文16px；待下一轮浏览器复测。
- 当前服务：API PID22385/43351，Vite PID25422/43352；恢复时需重新检查。先前tab3/4已关闭，本轮新建tab5。尚未清理临时环境，因为验收仍在进行。
- 新增第二需求 demand_mwfyjvr7_xukkc8 / conversation_mwfyjvs9_a44n0a；第一需求新增 conversation_mwfys3sm_m5adcl（验收 · 审批与异常）。均为合成数据。
- 并行开发：通过UI添加两需求，深色1440双列检查通过；Alt+右移排序后草稿A/B保持原面板归属，切会话到空会话不带旧草稿。其余布局和刷新仍待验证。
- 待完成：全页面三主题/三尺寸、并行完整用例、审批/问题/停止/失败、真实浏览器WS单独断连恢复、最终报告与清理。当前不能标记整体完成。

## 第四轮：流程验收与遗留复测
- 生产构建下浏览器WS代理43354单独断连10秒，双Tab重连后UI05只出现一次，API/Runtime进程未重启。消息在断连前已完成，因此不声称覆盖执行中的队列恢复。
- 并行两列/三列/四宫格切换及刷新布局已观察；只有两个面板，不能计为完整E2E-027。手机标题/Add操作收紧后增加会话可视高度。
- AddRepo补齐dialog语义、初始焦点/Tab/Esc及字段标签；需求列表头部统一布局；知识库/Skills补选中态；知识库无结果文案和字号修正；飞书设置820按钮换行修复。均需最新构建复测。
- 隔离Runtime夹具修正工具注册持久化、问题完成事件和审批拒绝语义；旧夹具导致UI09/10失败及UI07重复，旧结果不计通过。未修改产品协议层。
- 新会话 conversation_mwfzn8fv_fj08bk 经原生工具创建跟进 cb77f7b5-d273-4103-b5e0-bac9e3b0249d；UI编辑、暂停/刷新、恢复、立即运行、完成及站内通知闭环已观察。后台独立会话未污染来源会话。真实飞书未调用。
- 新UI12问题提交后刷新只有一条ANSWERED；与旧夹具缺事件结果区分。
- 已查看保存 overview-professional-after.jpg、notification-forest-tablet.jpg。前后概览数据量不同，交付时需注明。
- 最新状态中文化导致已有测试仍匹配“投递：pending”，现更新为“通知：等待投递”，重新运行完整verify，不能沿用前一轮绿色结果。
- 本轮恢复时API43351存活PID87354；浏览器旧tab5/6已关闭，新tab7。临时资源保留用于继续验收，最后统一清理。

## 第五轮：窄屏弹层复测
- verify-followup-labels-fixed 退出0：server263/web173、类型/构建通过。
- AddRepo：初始聚焦dialog，Shift+Tab到取消，Tab回关闭，Esc后回原添加按钮；字段标签已关联。
- forest知识库：13px源码、选中行强调、搜索无结果后清空恢复，1280无横向溢出；Skills选中态与元数据空文档提示已查看。
- forest飞书设置820新建按钮不再折行，375完整滚动至准备说明，scrollWidth=375；未填凭证、未发送外部消息。
- midnight跟进375：完成与“通知：已保存到站内”中文状态复测，截图已保存查看；打开后台历史确认继承来源并显示独立检查及只读设置。
- 发现手机会话详情转分享弹窗时关闭焦点丢失：ResponsivePanel提前释放原生顶层，工具菜单先回稳定入口；新增真实组件组合测试。verify-modal-handoff退出0：server263/web174；手机复测Esc恢复到“打开会话详情与操作”。
- 分享无可用机器人反馈与提交禁用、绑定列表搜索无结果及手动入口已观察。
- 发现代码上报手机弹窗786px容器却有1347px内容，overflow:hidden使底部记录压到0高且不能滚动。新增独立滚动body，顶部关闭保留；绑定手动/列表切换同步修复焦点丢失。新verify-report-scroll进行中，修复后仍待浏览器复测。

- verify-report-scroll退出0：server263/web174、类型/构建通过。375实际滚动代码上报body至top964（总1586，可视623），底部操作可见；绑定切换聚焦ID输入，切回聚焦搜索。
- 手机工具箱原来绝对定位超出抽屉左边界，改成抽屉内展开；verify-mobile-toolbox退出0并复测，面板left20/right302在375视口内，滚动至Repo与底部操作均可见。Runtime切换弹窗375已查看，未执行跨Runtime业务。
- AddDemandRepository长名称/路径与状态挤压：改为两行网格，状态不再独占横向列；verify-repository-option退出0；375长名称、状态分行复测通过，选择/无结果禁用/清空恢复正常。

## 第六轮：文件与富文本
- verify-search-focus退出0（server263/web174/types/build）；清空Repo搜索后主动聚焦输入框，待浏览器复测。
- 需求文件预览缺失/补入合成文件后成功/全屏与375布局均已查看。
- Mermaid窄屏标题被挤换行，新增工具栏换行与标题不收缩；verify-diagram-toolbar运行中。
- E2E004已补前进/后退证据，标记PASS。CSV复制内容读取待确认，不能计通过。

## 第七轮：并行布局、图片与 Workspace（已复核记录）
- verify-diagram-toolbar、verify-parallel-height 均退出0：server263/web174、类型与构建通过。
- Repo搜索清空后焦点回到搜索框，375无横向溢出。CSV点击后通过真实粘贴到输入区确认三行内容，随后清空未发送。
- Mermaid工具栏与图形适配375：stage277/svg241，放大与适配可用，白色图形完整；截图 conversation-forest-mobile-diagram.jpg 已查看。
- 真实UI创建第3/4需求；两任务同时运行、鼠标排序后草稿保持归属，单独停止A不停止B。两列/三列原来只占520px高度，改为使用board容器高度；1440三列面板794px，展开/返回/刷新、820/375均已观察。
- 图片上传进入原生协议夹具，返回1张且文件可读；刷新后灯箱仍可打开。审批拒绝返回REJECTED。未验证JPEG/粘贴/拖放，不把图片完整用例计通过。
- 第二Workspace先显示目录缺失错误，补齐临时目录后UI创建成功；并行页为空，切回Atlas保留4面板顺序、三列及会话选择。Workspace会话YOLO返回正确cwd，改只读后协议验证通过且刷新保留。
- 新截图 parallel-forest-three-columns.jpg 已查看保存。所有数据仅在/tmp隔离目录，不代表真实模型推理。

## 第八轮：安装窗口（继续中）
- 浏览器发现安装job轮询反复聚焦dialog，打断键盘操作；去除重复focus，让公共焦点指令仅在打开时处理。日志只在读者接近底部时跟随，避免阅读旧记录被拉走。
- 安装窗口日志字号提升到12px、状态13px；窄屏关闭按钮固定占位，日志允许收缩滚动。收起后恢复到执行摘要入口。
- 新增2项组件行为测试；verify-skill-focus退出0，随后保留原有安装测试并重跑web，39文件/176项通过。真实浏览器轮询期间焦点保持、Esc返回摘要、重新打开与375/820样式已验。121秒合成安装正常完成。
- 长任务终态移除暂停按钮后焦点曾落到body，追加定向转移到关闭按钮及测试；verify-skill-terminal-focus运行中，最终复测待完成。

- verify-skill-pausing-focus最终退出0：server263/web176/types/build。浏览器键盘Shift+Tab→Enter暂停，暂停中焦点留在“收起”，已暂停后留在“关闭”；Esc返回执行摘要。820深色截图 skill-install-midnight-tablet.jpg 已保存并查看。
- Flux绑定375深色无横向溢出，无效HTTPS地址得到明确错误；发现提交禁用后焦点丢失，增加字段aria-invalid/错误关联及失败后回输入框。verify-flux-error-focus退出0（server263/web176/types/build）。375复测无效链接错误后焦点回输入框；合成有效链接保存→刷新显示绑定与缺Skill禁用→二次确认解除→恢复未绑定，未访问外部Flux。

- 快捷指令实际执行已补：未发送草稿保留，global-review结构化Skill在用户消息中可见，原生夹具回复CODEX_FIXTURE_OK；刷新后指令消息仅1条。执行中的排队与失效Skill完整用例仍待补。
- 最新浏览器warn/error为空，git diff --check通过；API81556保留用于后续验收，浏览器2/tab9已标记handoff，临时视口已重置。没有生产发布。
- 下一轮优先：图片粘贴/拖放与移除；快捷指令完整状态；全部主要页面主题矩阵；同数据对比截图；最终审计与清理。当前仍不满足完整交付标准。

## 第九轮：同数据对比与快捷指令（继续中）
- 上一目标轮有实际浏览器/代码进展；中间分支清理问答没有改变UI目标。恢复后核实API81556与基线预览91120存活，旧tab9/10已关闭，新建tab11。
- 主页面深色概览/知识库/Skills详情已查看；快捷指令选中行增加强调背景与aria-pressed，启用状态使用文字标签，字体与手机表单间距调整。verify-selection-legibility退出0（server263/web176/types/build）。
- main d1cb439从git archive构建在/tmp/codywork-theme-review/baseline-main，通过43355只读查看同一隔离API。同数据1440旧/新概览截图已保存并实际查看，README已改为这组严格对比。
- 新合成指令“UI · 双 Skill 审阅”选择global-review与runtime-research，刷新保留两项；375深色搜索无结果、筛选仍保留选择、完整表单与底部按钮无横向溢出。停用保存后显示已停用。
- 发现保存按钮disabled导致焦点落到body；改为aria-disabled+提交守卫，保留键盘焦点；缺名称/内容的校验主动聚焦字段。新增2项行为测试；verify-quick-action-focus运行中，必须待完成后复测。

- verify-quick-action-focus退出0：server263/web178、类型/构建通过，git diff --check通过。375实际提交空名称回名称输入，保存后焦点保持“保存修改”；停用→刷新仍停用，恢复启用后两Skill保留。清爽1440/松林820/深色375快捷表单完整滚动查看，无横向溢出。
- 双Skill快捷指令空闲时发送显示两个结构化Skill；运行中点击显示“已加入发送队列”，两次执行终态正常；草稿UI_QUICK_QUEUE_DRAFT保持不变，清空后刷新历史恰好两条QUICK_MULTI，无重复。再次停用后工具箱只剩原指令1条。未验证手动Skill/待发送图片与快捷执行共存，不扩张为完整E2E017。
- 新quick-action-midnight-mobile.jpg已查看保存；console warn/error为空；API81556本轮无新增错误。旧版预览PID91120已停止，API保留；browser2/tab11 handoff、viewport reset。完整审计/其余矩阵/最终清理仍待完成，目标保持进行中。

## 第十轮：图片附件与灯箱（继续中）
- 上一目标轮有代码、自动检查与浏览器证据进展。恢复核实API81556/43351、WS代理45106/43354仍存活；继续browser2/tab11。
- PNG通过浏览器剪贴板粘贴，出现缩略图和移除入口；选择手动runtime-research并输入草稿，再执行global-review快捷指令，图片/手动Skill/草稿均保留。375深色composer截图已保存并实际查看。剪贴板已恢复原值。
- 删除待发图片后重新通过文件选择器加入：处理期间禁用上传与发送，结束恢复；带图片和Skill发送后协议夹具返回IMAGE_INPUT_RECEIVED:1/readable:true；刷新仍能打开图片。
- 发现375灯箱图片左48/right370，左右留白不对称：桌面48pxpadding与86vw图片上限冲突。宿主样式将grid限制在可用宽度、手机16px水平留白、关闭按钮44px；不改Core行为。verify-image-preview-layout退出0（server263/web178/types/build）；375图片left16/right359，1440左右留白约101px，手机与桌面均已实际查看。


## 第十一轮：实时恢复、配置与管理边界（已记录）
- 上一目标轮为实质进展（灯箱修复、图片与失败状态证据）；本轮继续核实API81556、Runtime81561、WS代理45106存活，没有重启。此前临时tab11/13已不存在，新建tab14/15，测试后关闭15。
- 两Tab发送QUEUE_E2E WS_RECOVERY_C/D：C立即显示正在发送，D显示已加入发送队列；SIGUSR1只中断43354浏览器WS10秒，两Tab显示重连且D仍排队。恢复后各1条用户消息和回复，无排队残留；重新打开并等页面恢复后C/D各1条。API/Runtime PID及启动时间不变。首次reload后的即时DOM尚未挂载，那个空结果不计验证证据。
- 启动拒绝及显式重试会留下2条failed outbox；未改造main独立构建也有同样行为。之后发送SLOW_E2E UI_AFTER_FAILURE：立即单条正在发送、完成单回复、刷新单条新消息，旧failed记录仍明确可重试；没有自动重发。不是本轮主题引入的差异。
- 图片：JPEG输入已验证1张/readable:true；PNG粘贴、移除、重选、上传禁用、手动Skill+草稿与快捷执行共存均已验。原生文件拖拽、超大文件/非法格式仍未完整验证。
- 概览375深色：清理弹窗路径可换行；确认前scratch.txt仍存在，取消不清理。确认期间操作禁用；完成变clean；同步全部逐仓库显示结果，汇总0更新/3最新/0跳过/0失败。刷新仍3个clean。只操作/tmp合成仓库。
- 清爽：知识库1440/375选择、源码滚动、无横向溢出；Skills详情与无结果搜索；820智能通知15分钟保存→刷新保留；创建站内测试通知→通知中心375→未读筛选→全部已读空态。铃铛轮询尚未更新时不会立即显示1，打开后刷新正确，不把等待轮询记为投递失败。
- 松林：Runtime1440测试连接成功，PID81561/启动次数1；代码上报弹窗展示未安装Hook、零值、会话列表和禁用补扫，不调用TEA。深色：820机器人表单从顶部至准备说明滚动查看，未填凭证、未保存或外发。
- 新建一次性会话conversation_mwg3lxz2_t3yqfh，重命名UI · 会话管理验收→刷新保留；删除绑定确认→取消→确认删除→刷新消失。手机从历史会话抽屉打开其他会话的删除弹窗并取消，焦点正确回到“打开历史会话”。没有删除原生历史。
- 深色并行1440三列与四宫格已查看；四面板553×390，页面scrollWidth=1440，刷新保留四宫格。截图runtime-forest-desktop.jpg、session-remove-midnight-mobile.jpg、parallel-midnight-grid.jpg均已保存并实际查看。
- 本轮无新增产品代码；沿用最新verify-image-preview-layout绿色结果（263+178），git diff --check通过，最终browser warn/error为空。viewport已reset，tab14 handoff。API/数据保留用于尚未完成的验收，未部署。

## 当前完成审计（以此为准，不以早期“进行中”日志推断）
- 已实现：三主题语义变量、持久化/首屏、全部主要页面与公共弹层的展示迁移、响应式、焦点、减少动态CSS。
- 有直接浏览器证据：概览、需求列表/会话、Workspace会话、并行、知识库、Skills/安装、设置总览及5个设置分区、通知抽屉、创建/目录/添加仓库/绑定/分享/上报/Flux/文件/图片/Runtime/删除弹窗；尺寸375/820/1440为代表性覆盖，未声称每个页面9种组合全部走完。
- P0六项001/004/007/008/011/016已有当前浏览器及补充自动化证据；016当前API日志无新增异常。独立业务用例仍按报告逐项记录，不以P0替代全部验收。
- 仍需执行：E2E清单中确属本次受影响且未执行的子步骤，剩余为短屏空态复测、本地停止/失败恢复精确子项和通知取消/异常子项；Git基线、并行附件及Workspace权限/Git/重启已取得直接证据；系统减少动态偏好的真实环境检查（当前浏览器工具没有媒体偏好模拟接口）；最终交付审计与临时资源清理。三主题/三尺寸采用代表性页面覆盖，不要求每个页面九种组合，不能反复以含糊的“全矩阵”作为下一步。
- 外部限制：没有专用飞书/TEA测试身份及外发授权（真实模型登录已在第十三轮确认可用）；协议夹具仅证明产品交互/状态，不证明这些外部服务成功。不得标为PASS。

## 第十二轮：失效引用、布局冲突与附件错误
- 上一目标轮产生了测试状态变化（有意重启隔离服务、移除夹具catalog中的global-review）；本轮接续完成该验证。中间GitHub分支问答未改变UI范围。旧tab14已不存在，创建16；并发测试17已关闭。
- 快捷设置显示明确的global-review失效提示和“需修复”；Demand工具箱禁用指令，title指出失效Skill及修复入口。移除引用→选择runtime-research→保存为v2→刷新→工具箱执行成功；原生用户消息含结构化runtime-research，刷新后UI_QUICK_REVIEW仅1条。目录由协议夹具提供，因此不声称覆盖真实Skill文件删除。
- 删除合成“UI · 双 Skill 审阅”：第一次显示“再点一次确认删除”，第二次才删除，刷新仅余1条。原指令继续可用。全程只修改隔离DB。
- 两浏览器Tab从同一四宫格版本出发：16保存三列，17改两列出现明确“布局尚未保存…其他页面更新”及恢复按钮；点击重新加载后为服务端三列且提示已保存。不是后写静默覆盖。
- 并行页新建conversation_mwg45rfv_25i3ao（UI · 并行移除恢复，属于portal需求），发送PAUSE_E2E。移除运行中面板→重新添加后仍在执行，打开完整需求页URL指向同一真实会话；显式停止后回并行页，保留所选会话。恢复四宫格。
- 原会话草稿DRAFT_PARALLEL_STATE、推理高、只读；切另一会话显示空草稿/中/Normal，切回恢复原草稿/高/只读。检查后清空未发送草稿。1440四宫格展开设置无页面横向溢出、无重复DOM ID；保存并查看parallel-forest-session-settings.jpg。
- 附件：SVG得到“仅支持 PNG、JPEG、WebP 或 GIF 图片”；32MiB合成PNG得到“请求内容过大”。错误后重新选择JPEG，出现缩略图、移除按钮和可用发送按钮，错误消失；删除待发附件，不发送多余消息。非image类型txt由已有Core输入过滤，不声称它会显示错误。原生跨应用文件拖入尚未完成。
- 最新console warn/error为空；无产品代码变更，不重复执行无变化的verify；沿用verify-image-preview-layout（server263/web178/types/build），git diff --check本轮通过。tab16已handoff，临时viewport已reset。未部署，临时资源仍用于剩余验收。


## 第十三轮：Git 边界和真实 Runtime（补录与复核）
- GitHub 分支核对不改动本目标：origin 默认 main d1cb439，master 已不存在；当前 UI 分支及未提交改动保留。
- 隔离夹具 UI 创建 demand_mwg4hux6_0qxtm2（feat/ui-baseline-round13），搜索跨筛选保留两 Repo；API tracked/untracked 改动丢弃、console detached 回 main，基线与新 Worktree 分别对齐 760ca22 / 9fa1331。已有 task-center Worktree 的 keep-round13.txt 保留。添加第三个 worker 的名称/路径/分支搜索、隐藏选择禁用、重开重置均已观察。
- 概览单仓库和批量同步覆盖：落后快进、最新、dirty 跳过；console 其他本地分支历史 2a55c7e 保留；detached 无独有提交恢复 main。本地领先 38be2c8、与远端 3a1f532 分叉、detached 独有提交均明确阻止，不强制改写。同步与扫描并发没有仓库消失；第一个仓库 fetch 失败后其余仍继续，汇总 0/2/0/1。
- 清理先取消再确认：仅 worker 基线 scratch-round13.txt 被清理，需求 Worktree 的 keep-worker-round13.txt 保留。远端失败的创建请求没有留下 Demand DB 行、Worktree 注册或根目录。失败表单在375宽度可滚动、按钮可达，页面无横向溢出。测试远端与 uploadpack 覆盖已还原；仅使用本地 bare 仓库。
- 会话删除守卫补验：最后一个会话、执行中、等待审批时均禁用删除；导航/会话栏折叠展开不停止任务。显式停止及拒绝审批后刷新恢复终态。结合之前重命名、取消、确认删除绑定及刷新证据，E2E-006 完整关键断言已覆盖。
- 新证据截图 repository-sync-guard-forest.jpg、demand-create-error-forest-mobile.jpg 已保存并实际查看。E2E-003 的清理阶段留待最终统一执行；当前产品没有独立删除 Demand 入口，不把不存在的入口记作已操作。
- 实际核实本机 codex 0.149.0 已登录；新隔离 API43356/PID62911 与真实 app-server PID62985 使用独立 /tmp/codywork-theme-real13/workspace.db。Workspace ws_mwg4yiiu_qzj8yc、Demand demand_mwg4zhky_ya94c0、会话 conversation_mwg4zhog_pcwy10。模型 GPT-5.6-Sol，仅合成内容，无外部消息。
- UI_NATIVE_01/02 实际只读命令完成；本轮重新打开同一URL恢复表格、Mermaid、三行TypeScript，复制得到准确换行并恢复原剪贴板。UI_NATIVE_03 的20秒命令观察到运行展开、完成自动折叠、手动重新展开；完成输出与退出0可见。native-tool-professional-desktop.jpg（1440×1000）已保存并查看。
- 当前真实模型文档沉淀验证进行中。旧“无真实模型身份”判断已纠正；协议夹具仍不等于真实模型/外部投递证据。没有产品代码变动，继续沿用最新263+178自动检查结果。


## 第十四轮：真实文档沉淀完成
- 上轮Git分支核对有新证据，但没有推进UI代码；本轮恢复时核实全部隔离进程仍活跃，旧tab16/18已不在，创建tab19，没有重启服务。
- E2E-005、006根据完整关键断言证据更新PASS；E2E-003核心边界已完成，最终清理待执行。
- 真实Codex命令、代码复制、Normal单次读写审批、需求文件链接预览均已验。文件变更数量错误定位到未改动Core（main与当前产物哈希相同），E2E-014如实标FAIL并单列既有缺陷；不修改协议或用样式掩盖。
- E2E-015 PASS：两次工具箱沉淀更新原文档而不重复追加，两文档重复沉淀前后哈希一致；新会话conversation_mwg5n8v1_itsric不提供答案即可从落盘文档回答CEDAR-47、默认主题、完成项与待办，刷新只保留1用户/1回复。
- 新截图native-tool-professional-desktop.jpg、native-approval-professional-mobile.jpg、native-handover-professional-desktop.jpg均已实际查看。最新console warn/error空，服务日志无新增错误，当前两原生Thread均completed。精确ID见E2E报告与/tmp/codywork-theme-real13/owned-native-threads.json。
- 现在只剩具体未完成用例，不重复泛称“全主题矩阵”：真实快捷指令授权/非授权与Skill删除修复；权限/Workspace/安装真实路径；本地跟进频率/重启与并行竞态；工具能力无法覆盖的原生文件拖拽/减少动态及外发需明确限定。最后做交付审计与一次性资源清理。
- 当前tab19已handoff、viewport恢复。两套隔离服务继续用于剩余验收，无活动Turn；未提交/部署。产品代码无变化，不重复跑同一全量verify。


## 第十五轮：真实指令授权与 Skill 文件失效
- E2E-017/018完成：AI明确授权创建并启用→工具箱即时可见→实际结构化Skill执行；普通评价不保存（DB完整行无变化）；无名称的“沉淀成快捷指令”自动提炼名称且只保存。
- 实际将/tmp的ui-review-a移出目录：刷新后设置需修复、工具箱禁用；手动换ui-review-b并保存v2，刷新及实际执行恢复，同一action ID。原测试Skill已还原。证据native-skill-missing-professional.jpg已查看。
- 真实指令ID：quick_action_mwg5sajh_2m4m7t（v2、ui-review-b）、quick_action_mwg5vo5g_iy871m（v1、ui-review-b）。仅隔离DB和合成文件改变，无产品代码变动。


## 第十六轮：真实安装与执行日志可读性
- 恢复时原隔离API/Runtime仍存活；上一真实安装Thread 01a1d940-85eb-75c2-9a64-b94fa0b0f203 于 08:54:09Z 终止，持续201.948秒；来源读取与sleep125完成，但Codex workspaceWrite将.agents作为只读目录，未落盘。不是观察超时，也没有因此重启任务；真实安装成功仍未验证。
- 新的手动暂停测试Thread 01a1d944-cc5e-7b61-811a-de10084bebbe：收起后摘要持续更新，重新打开可见实际cat输出与sleep命令；手动暂停后终态已暂停，没有安装文件。只操作/tmp合成Skill。
- 实际运行暴露大量provider.extension/command.bound/thread.context.updated挤占主要输出：将这三类既有诊断折叠在可键盘展开的运行诊断区，保留记录及原始事件数量，不改变Runtime事件/API或任务状态。
- 补充组件行为测试，verify-install-diagnostics退出0（server263/web179/types/build）。新构建真实任务看到命令与49条折叠诊断；Enter展开/收起、暂停中焦点回收起按钮通过。
- 820截图发现长来源挤压状态/耗时成为竖排：固定meta标签不收缩，来源使用剩余空间，700以下单独一行。verify-install-meta进行中，需等待完成后复测375/820/1440。

- verify-install-meta退出0（server263/web179/types/build），随后真实浏览器375/820/1440复测meta全部单行，无页面横向溢出；375来源独占下一行。运行诊断Enter展开/收起，暂停中→已暂停、焦点到关闭及Esc回摘要均通过。
- 三主题相同终态已实际查看；截图skill-install-professional-mobile.jpg、skill-install-professional-tablet.jpg、skill-install-midnight-diagnostics.jpg已保存且查看。视口改变后的第一张平板截屏捕获过渡帧，已用稳定820×1000截图覆盖，不计前者为证据。
- 刷新无残留安装中/弹窗，forest持久化，console warn/error空；真实API日志无新增错误。全部本轮安装已终止/手动暂停，精确原生Thread登记在owned-native-threads.json。tab20已handoff，视口reset；测试资源留供其余本地用例，未提交/部署。
- 仍未完成：Workspace完整权限/文件路径、站内跟进频率和重启子项、并行附件身份与可操作竞态、最终清理。真实Skill安装、外发、原生文件拖拽/系统减少动态检查按环境限制记录，不能宣称通过。


## 第十七轮：并行附件身份与 Workspace 原生边界（进行中）
- 上一目标轮有实质浏览器进展；中间 GitHub main/master 核对没有改变 UI 目标。恢复时 API49007/62911、Runtime49072/62985 与预览代理仍存活，没有重启。
- 并行面板 delivery/search 分别输入 DRAFT_PARALLEL_A17/B17 并加入同一合成 JPEG，各自上传后得到不同 image ID。切到同需求其他会话，当前可见 composer 为空；切回恢复原草稿与图片。注意 v-show 会保留隐藏 composer，不能把首个 textarea 当成可见会话。
- Alt 排序、三列鼠标排序后，draft/image ID 仍属于原会话；拖到标题区域外松手取消，顺序不变。两列与四宫格亦无页面横向溢出。截图 parallel-attachments-midnight.jpg 已保存并实际查看（修正原文件名误写 professional）。临时 tab20 已随轮次关闭，未发送测试草稿；附件文件留在隔离数据库，最终统一清理。
- 拖动中途 Escape 和持续边缘悬停不受当前原子 drag 工具支持，不能声称浏览器通过；对应 usePanelReorder 自动化已有取消/滚动/卸载测试。迟到布局响应由 useParallelLayout 自动化覆盖，浏览器已验证多 Tab 版本冲突与重载。
- 本轮 tab21 在真实API43356创建 Workspace 会话 conversation_mwg6w93b_l66vws，原生Thread01a1d956-7c0d-7422-8341-a622bd0ad29d。创建完成默认YOLO；首次消息即时单条，工具运行后正常终态。实际读取根/Repo规则、代码标记、知识事实、Workspace外自建哨兵、Git版本和Codex登录状态；本机HTTP访问返回401。模型先报告Repo规则标记再写入指定两个文件，磁盘内容一致，没有改真实仓库。
- 切只读后实际尝试写入 ui-readonly17.txt，命令返回 operation not permitted，文件不存在；同轮本机HTTP与Workspace外哨兵读取成功。未提权、未重试绕过。后续Skill/会话管理验证继续中。

- Workspace `$ui-review-b` 通过UI结构化选择发送，真实返回 CEDAR-SKILL-15。Normal 模式对根文件写入给出原生命令审批，“允许一次”后实际创建成功；对隔离目录外写入点击“拒绝”，命令卡failed，文件不存在；之后批准仅本机HTTP查询，终态明确区分成功/拒绝/401。375松林审批卡完整可见，workspace-approval-forest-mobile.jpg已保存并实际查看。
- 原生turn_context只读核对：YOLO=danger-full-access/never；只读=read-only且network_access=true；Normal=workspace-write/untrusted且network_access=true。没有产品自定义权限白名单，也没有更改全局Codex配置。
- 第二个Workspace会话conversation_mwg73zfn_yb1h8o（native01a1d95c-01d8-7bc2-98a3-55f96d0faf2c）创建中禁用表单，创建完成为空历史/默认YOLO。两会话分别重命名“UI · Workspace 边界17”“UI · Workspace 附件17”；切回首会话，刷新保留名称、Normal和9个article（4用户、4最终回复、1过程说明），URL仅workspace/conversation。后台原会话曾短暂显示待确认，重新订阅完成恢复已完成，没有残留审批卡。

- Workspace JPEG真实输入成功：UI_WORKSPACE_IMAGE_17返回CodyWork/概览，刷新后仍只有1用户+1AI，图片naturalWidth1440。直接新Tab22打开同URL恢复相同2条历史及YOLO；刷新后灯箱可打开/Escape关闭。workspace-image-forest-desktop.jpg保存并实际查看，1440无横向溢出。Tab22已关闭，21保留handoff，临时viewport已reset。
- 本轮没有修改产品代码，沿用最新pnpm verify（server263/web179/types/build退出0）；git diff --check通过，浏览器warn/error为空，真实API日志仅启动信息和既有SQLite实验提示。两新原生Thread均completed且加入owned-native-threads.json，仍需随整个隔离环境最终清理。没有提交、推送或部署。
- 下一步保持具体范围：完成剩余本地跟进频率/通知重启恢复、Workspace本地Git与删除清理；整理最终覆盖表和未验证限制。真实外部飞书/TEA无授权、Core已有文件计数问题、浏览器不支持拖动中途按键/媒体偏好模拟，分别保留明确限制，勿反复重测已通过主页面矩阵。


## 第十八轮：通知策略与重启恢复
- 上轮工程检查的同一进程已确认退出0；verify-notification-labels18.log：server263/web179、类型检查及构建通过。没有因观察超时重复启动。
- 实际页面发现 not_requested 原始英文，补为“本轮无需通知”，同时补齐 needs_attention/ delivered 的中文；在已有组件测试中核对。接收设置提示改为“符合通知规则的结果”，避免暗示每轮都进入通知中心。没有改动通知判定或投递协议。
- UI创建每次/变化/结束三个站内任务，均60分钟、明确截止、原会话conversation_mwfzn8fv_fj08bk；模型结果采用可控原生协议夹具。四轮分别为pending事实1、同事实改摘要、pending事实2、completed事实3。每轮均通过UI立即运行并刷新记录：通知数分别4/3/1，与策略一致；终态立即运行禁用。事实不变改措辞不会触发change。
- 三任务已completed后显式停止隔离API38774，再启动同DB的API64052。8条UI18通知保留且无重复；结束通知已读保持、未读7；未读筛选排除该项，全部已读后显示0和空态。查看原会话恢复正确workspace/demand/conversation URL。总运行记录13（含旧任务1），没有重启补跑。
- notification-policy-midnight-mobile.jpg保存至assets且实际查看：375×900通知抽屉全宽，文字/三操作按钮可读，document.scrollWidth=375；所有通知均飞书未开启，没有外发。
- 键盘补验：Enter真实插入换行，选择runtime-research和fixture-skill后Control+Enter发送；10秒延迟时第二条立即排队，UI18_UNSENT_DRAFT保持，结束后两轮各一次；刷新后两个唯一用户文本各1条。夹具持久化history过滤掉skill item，因此本轮不能单凭该history证明结构化Skill入参；先前真实Skill与快捷指令验证仍为独立证据。
- 浏览器warn/error为空，API重启日志只有启动行/既有SQLite提示，git diff --check通过。真实Workspace Git与最终清理仍在继续，未提交/部署。

- 真实Workspace补验：UI_WORKSPACE_GIT_18在Normal通过页面逐项“允许一次”，先读取根/Repo规则，再仅提交ui-probe17.txt并推送到/tmp本地bare的ui/normal18。磁盘核对提交de600a4510d9a52bcf768242c5168cfa2ea436f9与bare引用一致；其他AGENTS.md/ui-marker17.ts未提交。UI终态4m30s。
- 真实服务四个会话均completed后显式重启；首次启动命令漏写app-server参数，原生进程exit1，UI显示明确不可用且不自动重启。此为验收启动配置错误；修正为node codex app-server --stdio再显式启动，原URL恢复相同Thread、Normal及Git消息恰好1条。未因观察超时重启。后续YOLO本地写入/推送正在运行。

- YOLO重启后实际写入ui-probe17.txt与隔离Workspace外outside-write18.txt，提交/本地bare均为3f48134fe89851ba5cbc347c6dd8318c9431fe73；UI25秒完成，刷新唯一消息且YOLO保留。
- 两个Workspace会话通过菜单删除，确认框明确只移除绑定、保留原生历史；最后一个删除回到概览，再进Workspace会话自动创建conversation_mwg84z69_c4r6u1，默认YOLO、空历史。新原生ID追加清理manifest。
- 1280×720新空态截图发现标题被挤出可视区：Core空态min-height320加产品留白导致内容414px、可视区218px并自动滚到底。新增仅max-height800且仅空态的紧凑留白/尺寸，保留历史布局与所有内容。verify-empty-short18进行中（session79344），完成后必须复测1280×720、375×812/低高度与1440×1000，并替换截图，不能提前标通过。

- verify-empty-short18同一进程退出0：server263/web179、类型检查/生产构建通过。真实浏览器1280×720复测：可视区218、scrollHeight218、scrollTop0，标题y255–289完整位于y191–410；375×720页面宽375、空态无滚动；1440×1000保持原有宽松布局且标题完整。三张均实际查看，错误截图workspace-recreated-forest.jpg已由修复后的截图替换，另存workspace-empty-forest-short-mobile.jpg。
- 最终本轮console warn/error为空，viewport已reset，tab23保留handoff。真实API68229/43356（session59875）、夹具API64052/43351（session94699）仍用于剩余验收；新Workspace空会话idle，无后台任务执行。未提交/推送/部署产品代码。
- 下一步仅做未完成的本地失败恢复/停止与通知取消异常子项，核对外部/工具限制，再统一清理临时资源和交付审计；不要重跑已验证的通知四轮或Workspace Git与主页面矩阵。


## 第十九轮：交付审计
- UI失败重试/停止、定时跟进暂停恢复/取消确认、待处理结果及通知卡片补验完成，详情见E2E第十九轮。未修改产品代码，保持最后verify对应工作树。
- 最终console warn/error为空；1440通知卡片稳定截图已保存查看。39张实际JPEG纠正扩展名，保持原始画面。
- UI移除三个测试工作区登记→两套DB均0条→磁盘仍保留→仅清理两个/tmp测试根目录；9个测试会话中8个通过应用归档，未索引空会话保留原生审计文件。全部本轮监听端口/进程已退出。
- 重新核对同数据前后截图1440×1000、主题代码/测试/业务边界、完整verify原日志与git diff --check。最终逐项需求审计写入FINAL_AUDIT；既有Core计数、外部渠道和工具限制未包装为通过。
