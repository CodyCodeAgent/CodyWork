# CodyWork E2E 回归记录：系统级主题与交互改造

- 日期：2026-11-14
- 执行者：Codex
- revision：main d1cb439 上的 codex/workbench-theme-system 未提交工作树
- Core：0.43.1（沿用已有 Fast 补丁，无共享协议改动）
- 环境：http://127.0.0.1:43351；断连测试代理 43354；生产 dist
- 浏览器：Codex IAB，1440×1000 / 820×1000 / 375×812，另有1280×720检查
- 临时数据库：/tmp/codywork-theme-review/workspace.db
- Workspace：ws_mwfwy9nx_89qfil，/tmp/codywork-theme-review/workspace
- 执行引擎：有状态原生协议 fixture，不代表真实模型认证/推理。Git仓库与API/UI均真实运行，origin为本地bare仓库。

## 结论
本报告记录 UI 改造提交和部署之前的本地交付审计。P0 全部通过；业务全量 E2E 并非全部通过。下面逐项区分完整通过、既有缺陷及未验证边界。最终范围审计与清理见 [FINAL_AUDIT.md](../../ui-refresh/FINAL_AUDIT.md)。历史轮次中的“待执行”以本表和最终审计为准。

## 用例结果
| 用例 | 结果 | 当前证据 | 剩余 |
|---|---|---|---|
| E2E-001 | PASS | 错误密码阻止进入/正确登录；375深色登录截图；刷新、新Tab恢复合成Workspace；会话实时连接 | 仅隔离环境 |
| E2E-002 | BLOCKED（指南入口差异） | 注册、扫描、clean/dirty、刷新、目录缺失恢复均已验；最终 UI 取消/确认移除及空态刷新通过 | 当前仓库管理是添加入口，没有指南描述的仓库管理搜索；未新增业务功能来迁就用例 |
| E2E-003 | PASS | 双Repo搜索保留选择、更新远端基线/丢弃脏修改/detached恢复、添加第三Repo筛选重置；失败无半成品 | 通过移除一次性 Workspace 清理 Demand 绑定，磁盘 Worktree 随本轮隔离目录清理；没有单独删除 Demand 入口 |
| E2E-006 | PASS | 折叠/展开、跨需求会话、重命名刷新、删除绑定确认；最后会话/运行中/待审批删除均禁用 | 仅隔离会话 |
| E2E-004 | PASS | 两需求和真实会话URL、刷新、新Tab历史；概览前进/后退恢复后台会话，最终回复只出现一次 | 仅隔离环境 |
| E2E-005 | PASS | 单仓库与批量快进、dirty跳过、领先/分叉/detached独有提交阻止；其他分支历史保留、扫描并发、首仓失败继续、清理不动Demand哨兵文件 | 所有remote为一次性本地bare，无外部Git推送 |
| E2E-007 | PASS | UI01/02及UI_AFTER_FAILURE立即单气泡、终态及刷新单条；启动拒绝保留failed outbox和重试按钮，不自动重发 | 手动重试再次失败会保留两次failed记录，main也如此；原生协议夹具 |
| E2E-008 | PASS | UI01–05含工具/Markdown、相同回答不同回合保留；双Tab与刷新共10条用户/AI消息，无重复 | 安全协议fixture |
| E2E-009 | NOT RUN（部分断言已验） | Enter 换行、两个 Skill 引用、Control+Enter、延迟时排队和草稿保持、刷新各消息一次；真实 Skill 执行另有证据 | 本轮夹具 history 过滤 skill item，未保留同一次双 Skill 的原始请求作为结构化入参证据，不能宣称完整通过 |
| E2E-010 | PASS（协议夹具） | UI_UPSTREAM_19 失败后显式重试一次成功；PAUSE_E2E UI_STOP_19 显示单个 cancelled 工具状态、输入框恢复空闲；刷新不回 running | 原失败回合与新重试回合各保留一次，未自动重发；不代表真实上游服务成功 |
| E2E-012 | BLOCKED（真实 provider fallback） | 1/5 到 5/5 后失败；浏览器仍连接；手动重试成功；API93285/Runtime94898 未重启 | 夹具未验证真实 HTTPS fallback/超时；终态显示原始 provider 错误，没有“未自动重发”字样，未改共享 Core 提示契约 |
| E2E-011 | PASS | WS_RECOVERY_C/D执行/排队时切断WS10秒，两Tab显示重连并保留队列；恢复及刷新各1条，API81556/Runtime81561启动时间不变 | 关闭码/重试状态另由现有conversationSocket测试覆盖；真实上游不在此用例 |
| E2E-013 | BLOCKED（原生跨应用拖入） | PNG粘贴/JPEG选择/移除/发送/刷新灯箱；SVG与超限报错后可恢复JPEG上传 | 原生文件拖入；非image文件被现有Core过滤，不显示格式错误 |
| E2E-014 | FAIL | CSV、Mermaid、预览、长路径375已验；真实工具展开→终态折叠→手动展开及三行代码复制准确 | 既有Core把status说明计入文件数：单文件显示3；main与当前Core产物哈希相同，非本次样式修改引入 |
| E2E-015 | PASS | 真实模型更新现有ui-review-notes；再次沉淀两文档哈希不变；新原生会话读取暗号/主题/已完成/待办并引用依据，刷新仍单用户/单回复 | 仅临时需求，不代表外部知识服务 |
| E2E-016 | PASS | 概览/需求列表/会话/知识库/Skills/设置及主要弹层；375/820/1440、空/忙/成功/失败/禁用、键盘焦点；最终console为空、当前API无新增异常 | 三主题代表性覆盖；更细的业务用例仍逐项保留未完成状态 |
| E2E-017 | PASS | 双Skill配置/持久化/启停/删除、排队且保留草稿附件；真实AI明确授权创建、未授权不保存、自动命名与结构化Skill均已验 | 仅临时Workspace，未调用外部业务Skill |
| E2E-018 | PASS | 真实移除ui-review-a文件，刷新Skill目录消失；设置需修复/工具箱禁用；同指令换ui-review-b保存v2/刷新/实际执行恢复 | 原Skill已恢复，测试文件均在/tmp |
| E2E-019/021 | BLOCKED（外部边界子项） | 真实Workspace规则/知识/CLI/Skill；YOLO写入、只读拒写、Normal批准与拒绝、三模式本机HTTP；双会话重命名刷新 | Normal/YOLO本地bare推送、重启恢复和删除最后会话/重建已验（第十八轮）；通道文件/其他用户目录等完整边界仍未全覆盖 |
| E2E-022 | BLOCKED（真实安装落盘） | 夹具121秒完成；真实运行201.948秒、来源读取/sleep完成；另次真实任务收起/重开/手动暂停成功 | Codex workspaceWrite拒绝写.agents；来源与frontmatter有效，文件未安装。展示改进已复测三主题与375/820/1440，不标实际安装成功 |
| E2E-023 | BLOCKED | 375深色分享弹窗、无机器人提示、提交禁用均可见 | 无专用飞书账号和外发授权，不发送真实文档 |
| E2E-024/025/026 | BLOCKED（外部投递与精确竞态） | 站内测试通知；跟进原生工具创建→编辑→暂停刷新→恢复→立即检查→完成→通知已读→原会话；后台历史独立只读 | 三策略四轮、终态重启、取消确认/持久化、待处理结果与站内通知已验；fork/投递精确竞态只有既有自动化覆盖，邮箱解析/真实飞书外发未验 |
| E2E-020 | BLOCKED | 飞书设置820/375完整滚动检查，不修改业务权限 | 真实外发未授权，无专用机器人 |
| E2E-027 | BLOCKED（拖动中组合操作） | 四面板/三布局/刷新/服务重启、Alt与鼠标排序、双任务独立停止、草稿与设置随会话恢复、两Workspace隔离；多Tab冲突重载、运行中移除重加、新建真实会话与完整页一致 | 附件身份与外部松手取消已验；中途Escape/边缘悬停工具不支持，取消/滚动/迟到响应有自动化覆盖，浏览器不可冒充完整通过 |

## 发现并修复的问题
- 统一语义色、Core主题桥接；松林导航次要文字对比度修正后自动对比度测试通过。
- 状态文字与背景同色、侧栏长标题挤压、空仓库贴边：已修正并逐项检查。
- 自定义弹窗缺键盘范围：共享v-modal-focus，创建需求/Workspace/嵌套目录/AddRepo初始焦点、Tab循环和Esc恢复通过。
- AddRepo缺dialog语义/字段标签：已修正，1280浏览器验证关闭回到添加入口。
- 知识库/Skills选中态弱、无搜索结果文案错误：已修正，forest1280复测，源码字号13px，无横向溢出。
- 飞书设置820新建按钮折行：已修正；820及375完整滚动截图已查看，375 scrollWidth=375。
- 跟进运行记录原始英文：改中文，375midnight完成/站内通知已查看，无横向溢出。
- 手机抽屉打开分享后关闭焦点丢失：修正关闭时序，追加组件组合测试；375复测关闭后回到可见会话入口。
- 代码上报弹窗手机内容裁切：独立滚动body修复，375实际滚动到底，底部操作可见；标题计数换行进一步收紧，375复测底部操作与标题均可见。
- 绑定弹窗列表/手动输入切换丢焦点：切换后聚焦对应输入，375双向切换已验证。
- 手机工具箱沿用桌面绝对定位导致左侧裁切：改为抽屉内展开布局；375复测面板left20/right302，Repo与底部操作均可见。
- 夹具自身曾漏持久化tool注册、问题item完成事件，审批拒绝结果也不准确：已在/tmp修正；旧UI07/09/10不算产品通过证据，UI12重新验证问题提交/刷新单条。未修改Core业务。

## 截图
位于 ../../ui-refresh/assets/，已实际查看：
- overview-before.jpg / overview-professional-after.jpg：同1440×1000，数据量不同（旧空态与新3仓库），不是严格同数据对比。
- settings-midnight-migrated.jpg、settings-forest-migrated.jpg
- conversation-midnight-tools.jpg、login-midnight-mobile.jpg
- notification-forest-tablet.jpg、followup-midnight-mobile.jpg

## 健康检查
- pnpm verify：verify-followup-labels-fixed.log 退出0，server263/web173，类型与构建通过；旧bundle大小警告保留。
- verify-modal-handoff 与 verify-report-scroll 均退出0：server263/web174、类型和构建通过。verify-mobile-toolbox、verify-repository-option、verify-search-focus 均退出0：server263/web174、类型与构建通过。
- 浏览器：第十九轮最终 warn/error 为空；1440 通知页 document.scrollWidth=1440。
- 服务端：最终运行期间日志仅启动与既有 SQLite 实验提示；历史夹具退出/故意错误启动已分别记录，不算本次样式引入异常。
- 最终产品代码对应 `verify-empty-short18`，server 35文件/263测试、web 40文件/179测试、类型检查及生产构建通过；原日志保存在 [verify-final.log](../../ui-refresh/evidence/verify-final.log)。之后仅调整验收文档和临时夹具，未再改产品代码。

## 清理
已在 UI 移除 Atlas、Boreal、Cedar 三个临时 Workspace 登记，核对两套数据库 workspaces=0，磁盘仓库当时仍存在，符合确认文案。随后停止本轮43351/43352/43354/43356进程及其Runtime，确认43351–43356测试端口无监听；删除两个精确的/tmp测试根目录（含DB、图片、Git/bare/Worktree与夹具）。浏览器临时25已关闭、viewport已恢复，其他标签未动。8个实际使用的原生测试Thread通过应用归档；一个从未发消息的Thread未被应用索引找到，保留原生审计文件，未直接改用户的全局会话数据库。截图、最终verify日志及精确manifest保留在docs/ui-refresh。

## 第六轮补充（继续中）
- 添加需求Repo375长名称/路径与状态分行复测通过；选择启用提交、无结果清空选择并禁用、清空恢复列表。清除按钮消失后焦点曾落到body，已改为返回搜索框，最新构建375复测焦点回到搜索框。
- 文件预览：缺失文件显示具体需求路径；补入合成文件后读取365bytes Markdown/表格/代码正确。1440全屏、退出按钮及375完整内容已实际查看，页面宽度375。
- Mermaid源码展开和白色画布可见；发现窄屏工具栏标题断行，已补不收缩标题与工具栏换行，verify已通过，375图形241px完整位于277px画布；放大/适配已复测。CSV工具剪贴板读数为空，但真实粘贴到输入区得到正确三行CSV，清空未发送；控制台无error/warn。

## 第七轮补充
- verify-parallel-height退出0（server263/web174/types/build）。三列/双列桌面面板高度从固定520修复为可用容器高度，1440×1000实际面板794px；四宫格、展开和375单面板不受影响。
- 4个真实需求并行UI：双任务PAUSE_E2E运行，鼠标重排后各自草稿保持；停止搜索任务后门户仍运行，再单独停止门户。刷新保留布局/顺序/会话。旧失败会话缺历史是夹具已知缺陷，不计成功证据。
- 新图片会话上传PNG，原生协议夹具回复IMAGE_INPUT_RECEIVED:1/readable:true；灯箱打开/关闭/刷新再打开已验。新审批拒绝→REJECTED。未实际调用模型。
- 第二合成Workspace ws_mwg1c16u_d0nu6h 初始并行为空，切回Atlas恢复4面板与所选图片会话。新Workspace会话conversation_mwg1dug7_wxv9e1分别验证YOLO正确cwd/只读策略、刷新及375forest。
- 新截图 parallel-forest-three-columns.jpg、conversation-forest-mobile-diagram.jpg 已保存并实际查看。
- API本轮PID81556/43351；浏览器2/tab9。旧tab8已不存在；未重新启动运行中的服务。

## 第八轮：Skill安装与需求列表
- Skills安装使用本地原生协议夹具，仅验证产品执行链路，不安装未知外部代码，也不声称真实Skill文件安装通过。
- LONG_INSTALL_E2E运行121秒后完成，期间收起、切换需求列表与设置主题、返回重新打开，任务持续运行。820深色与375松林弹窗均实际查看。
- 发现原watch在每次job轮询时强制聚焦dialog；改由公共指令管理打开焦点，输出新增只在读者靠近底部时跟随。安装日志字号从10.5提升12px，状态13px。收起后恢复到执行摘要。
- verify-skill-focus、verify-skill-terminal-focus均退出0；新增独立accessibility测试后web39文件/176项通过，保留原有安装测试。
- 浏览器复测捕获暂停中按钮禁用导致焦点先丢失，单独处理终态不足；已改为在pausing开始时转移到收起按钮并覆盖中间状态。verify-skill-pausing-focus退出0（server263/web176/types/build）；浏览器最终复测暂停中焦点为“收起”、终态为“关闭”，Esc返回摘要。截图skill-install-midnight-tablet.jpg已查看保存。
- 需求列表375与1440松林主题已实际查看：标题操作区、长路径、4条需求完整，无页面横向溢出。
- 本轮浏览器console warn/error为空，API81556启动后没有新增错误；旧fixture退出错误保留在更早日志。

## 第九轮：Flux表单与快捷执行
- Flux绑定375深色：无效HTTPS链接显示具体错误；修复后aria-invalid与错误文本关联，失败回输入框。合成URL使用全1/全2数字ID，只保存本地绑定，未请求外部Flux。
- 有效合成绑定保存后关窗回原入口；刷新后工具箱显示协作ID、“需要安装Skill”及禁用指令；管理绑定第一次点击“解除”仅进入确认，第二次点击才解除，最终显示未绑定。
- verify-flux-error-focus退出0：server263/web176、类型检查及生产构建通过；仅既有bundle大小提示。完整用例仍按上方NOT RUN/外部BLOCKED记录，不把这些子步骤扩大成全部通过。
- 快捷指令：保留未发送草稿后点击“验收 · 只读状态检查”，正常新消息带global-review Skill并得到CODEX_FIXTURE_OK；草稿不覆盖。清空测试草稿再刷新，UI_QUICK_REVIEW消息匹配计数1。
- 本轮最终console warn/error为空，git diff --check通过。API81556未重启，browser2/tab9 handoff、viewport reset；测试环境仍用于后续验收，尚未清理。没有生产数据修改或部署。

## 第十轮：快捷指令与严格截图对比
- main d1cb439隔离归档构建与新版都使用同一合成Workspace。overview-main-same-data.jpg和overview-professional-same-data.jpg均1440×1000，3仓库/4需求/1文档/35Skills，已实际查看。替代早期数据量不一致的截图作为对比证据。基线预览43355已停止。
- 指令列表选中态、状态文字、字号与手机布局优化。发现保存disabled导致焦点掉到body，修复为aria-disabled+提交守卫，新增2行为测试；空名称校验聚焦名称输入，保存后焦点留在保存按钮。verify-quick-action-focus退出0：server263/web178/types/build。
- 快捷配置深色375、松林820、清爽1440均完整查看含底部操作；375/820 document.scrollWidth与视口相等。Skill搜索无结果正确，两Skill筛选与刷新保留；停用刷新仍停用，重新启用版本递增，后续再次停用使工具箱仅显示原指令。截图quick-action-midnight-mobile.jpg已查看。
- conversation_mwfys3sm_m5adcl：QUICK_MULTI空闲直接发送，消息含global-review+runtime-research；QUEUE_E2E运行中再次点击显示排队，保留草稿UI_QUICK_QUEUE_DRAFT。两任务结束后排队提示消失，清空草稿再刷新，历史QUICK_MULTI恰好2条，均有回复。仅原生协议夹具验证，不代表真实AI自然语言授权判断。E2E017仍未完整覆盖删除/手动Skill+图片/自然语言不授权用例。
- browser2/tab11最终warn/error为空。API81556启动后的服务日志无新增错误；历史预期fixture退出错误未清除。git diff --check通过；未部署生产。tab11已handoff、viewport恢复，主隔离API及数据留待后续矩阵和最终清理。


## 第十一轮：附件、实时连接与页面补验
- verify-image-preview-layout退出0：server263/web178/types/build。手机灯箱16px对称留白，桌面约101px对称；image-preview-midnight-mobile.jpg已查看。PNG粘贴+手动Skill+草稿在快捷执行后保留，删除/重新选择/上传中禁用/发送/刷新均观察；JPEG回复IMAGE_INPUT_RECEIVED:1/readable:true。原生拖拽和非法文件仍不算完整通过。
- 主分支基线独立UI重现启动失败重试后的两条failed记录；没有改动Core。新版SLOW_E2E UI_AFTER_FAILURE之后能正常执行，初始单条→CODEX_FIXTURE_OK→刷新单条，旧失败状态稳定。
- 浏览器tab14/15连接43354，C正在发送、D排队时切断仅浏览器WS10秒；两Tab即时显示重连，第5/6次时队列仍可见。恢复后C/D各执行一次，第二次打开原会话并等connected后C/D均计数1。API81556与Runtime81561的启动时间均不变。补充断连查看“连接状态与Runtime”显示真实重连状态；恢复后正常。没有因健康检查重启进程。
- 清理确认前/tmp合成worker仓库scratch.txt仍存在；取消→再次确认→清理中禁用→clean；批量同步逐行结果，最终3个已是最新，刷新保持。没有覆盖005中全部分支冲突语义，因此005仍保留NOT RUN。
- 清爽知识库375/1440、Skills详情/搜索空态；通知设置820保存15分钟并刷新；通知抽屉375、未读筛选和全部已读空态。松林Runtime1440连接成功、上报未安装状态；深色机器人820表单全长。均查看截图，无非预期页面横向溢出。
- 一次性会话conversation_mwg3lxz2_t3yqfh创建/重命名/刷新/删除绑定/刷新消失；手机历史抽屉→删除弹窗→取消回“打开历史会话”焦点。未删除业务会话。
- 深色并行四宫格1440：四面板553×390，刷新保留选中布局。图片证据runtime-forest-desktop.jpg、session-remove-midnight-mobile.jpg、parallel-midnight-grid.jpg均实际查看。
- 本轮最后console warn/error为空，git diff --check通过。无新产品代码，未重复跑无变化的verify。浏览器14 handoff，15关闭，viewport reset；测试进程/数据仍保留用于继续验收，尚未做最终清理。整体仍未标完成。

- P0-016健康补核：production-server.log共13行；PID81556启动后只有SQLite既有实验提示与启动日志，无新增异常。唯一旧smart-notification失败发生在之前夹具退出，不能算当前进程异常。上述页面/弹层和状态已逐项有浏览器证据，因此016由NOT RUN更新PASS；不把它扩大成全部业务E2E通过。

## 第十二轮：配置失效与并行恢复
- 隔离API有意重启为PID49007，Runtime49072；环境catalog过滤global-review。设置中显示“需修复”并指出该Skill；工具箱指令disabled，title解释修复入口。移除引用、选runtime-research、保存v2、刷新后执行成功，用户消息中结构化Skill正确，刷新消息计数1。只是catalog模拟，真实文件删除仍未测。
- 双Skill合成指令点击删除先出现二次确认，再确认后删除，刷新剩1条；不影响修复后的原指令。
- 1440两Tab同版本布局：16改三列成功，17改两列出现版本冲突和“布局尚未保存”，重新加载后恢复三列/已保存。17已关闭。
- 并行新会话conversation_mwg45rfv_25i3ao属于demand_mwg120ke_xqt7mh。运行PAUSE_E2E后移除面板，再添加依然执行；完整需求页URL与历史为同一会话。显式停止后返回并行保留选择。草稿/推理高/只读切换后恢复，另一会话空草稿/中/Normal保持独立；测试草稿已清空。
- 四宫格设置展开的1440布局已截图并查看，scrollWidth=1440，重复DOM ID为空。证据parallel-forest-session-settings.jpg。
- SVG上传返回格式错误，32MiB合成PNG返回请求内容过大；之后正常JPEG上传恢复缩略图和发送，移除附件成功。txt非image文件被原有Core输入层过滤，未显示错误，不把该路径算通过。无真实文件拖入证据。
- console warn/error为空；PID49007之后服务日志只有既有SQLite实验提示和启动日志。无新产品代码；最新完整verify仍为263+178，类型/构建通过。当前浏览器2/tab16 handoff、viewport reset。43351/43352/43354及隔离数据尚未清理，待剩余验收结束后统一处理。


## 第十三轮：Git 边界与真实 Codex
- 追加 API43356/PID62911、原生 app-server PID62985，独立数据库 /tmp/codywork-theme-real13/workspace.db。实际 Codex 0.149.0 已登录，不再将真实模型认证列为阻塞。仅使用合成任务和临时仓库；没有飞书或TEA外发。
- 第十三轮详细Git证据见 [PROGRESS.md](../../ui-refresh/PROGRESS.md)：多仓创建基线760ca22/9fa1331，安全同步2c34836/2f2da8a，其他分支2a55c7e保留；领先38be2c8、分叉3a1f532、detached独有提交阻止；首仓fetch失败后其余仍完成，汇总0/2/0/1。所有远端及uploadpack测试配置已恢复。已有Demand两个哨兵文件仍在。
- 失败创建feat/ui-unavailable-round13没有DB行、Worktree注册及目录；375失败表单完整可操作。repository-sync-guard-forest.jpg、demand-create-error-forest-mobile.jpg已查看。
- 真实会话conversation_mwg4zhog_pcwy10：UI_NATIVE_01/02恢复表格、Mermaid和三行代码。复制结果含准确三行及结尾换行，随后恢复原剪贴板。UI_NATIVE_03实际20秒只读命令运行中展开，终态自动折叠且可重新展开查看退出0/输出；1440截图native-tool-professional-desktop.jpg已保存并查看。
- Normal合成文档任务出现原生单次命令审批，批准仅当前目录读取命令后继续；不调整全局权限，不访问其他业务目录。文档沉淀验证继续中。

- 真实文件变更暴露已有Core展示问题：只新增docs/ui-review-notes.md，但卡片先计2后计3。已定位当前安装Core的vue/dist/index.js 405–424把tool.details（含status行）的去重长度当文件数；main隔离构建与当前该文件SHA1完全相同（21ec9fdae0f0a408e92a1181a2140311a6744c16），依赖/锁文件本轮没有修改。这是明确的现存显示缺陷，不用主题CSS掩盖或改写协议。卡片仍能终态自动收起。E2E-014保留未完整通过，需最终说明Core范围限制。


## 第十四轮：真实沉淀闭环
- 文档初建经过Normal单次命令/文件审批，目标仅当前临时Demand的docs/ui-review-notes.md。实际文件366bytes、六个分类标题；浏览器点击回复中的相对路径成功预览，原repo Git状态仍干净。
- 从工具箱实际点击“沉淀”：模型读取docs与对应Repo状态，在现有ui-review-notes.md定向增加验证段落，保留原背景/事实/决策/完成/风险/待办，没有另建handover.md。375原生文件审批卡完整可见，允许一次/拒绝按钮可操作；截图native-approval-professional-mobile.jpg已保存并查看。
- 再次点击“沉淀”：模型报告无新增可验证事实。只读文件核对context.md和ui-review-notes.md的SHA256全部保持不变，后者acccda9acf204a4804b1f448c2ea09640077be25ed210ebee688f1158213c74d。未追加重复段落。
- UI新建同Demand独立Codex会话conversation_mwg5n8v1_itsric。提示只问上一会话的暗号、默认主题、完成项、待办，不提供答案也不手工粘贴原文。模型只读当前需求文档后正确回答CEDAR-47、清爽专业、三种主题命名与阅读布局、验证键盘焦点，引用docs/ui-review-notes.md和docs/context.md。
- 刷新新会话后仍仅两个article（1用户/1回复）；1440页面scrollWidth=1440，重复DOM ID为空，console warn/error为空。native-handover-professional-desktop.jpg已保存并实际查看。API62911日志仅启动信息及SQLite既有实验提示，原生进程62985未重启。
- 两个真实原生Thread分别01a1d925-8857-7893-bb9a-cd7ce13eea08与01a1d936-71a3-7821-bb7d-ee225a958603，DB均completed。精确测试资源记录保存在/tmp/codywork-theme-real13/owned-native-threads.json供最终清理；不清理任何其他用户Thread。
- 本轮只更新验收文档/截图，没有产品代码变更；最新verify-image-preview-layout仍为server263/web178、类型与构建通过。隔离服务43351/43352/43354/43356保留供尚未完成用例；tab19 handoff、viewport已reset。未部署或提交。


## 第十五轮：真实快捷指令和 Skill 失效闭环
- 上轮为实质进展；恢复核实62911/62985/49007仍运行，继续tab19，无重启。真实Workspace目录准备了仅含合成Marker的README供ui-review-a/b只读执行。
- conversation_mwg5n8v1_itsric发送UI_QUICK_CREATE_15，明确授权名称/完整Prompt/默认ui-review-a/启用。实际出现3个Dynamic tool call，保存quick_action_mwg5sajh_2m4m7t；未刷新工具箱即出现1条，设置显示v1/由需求会话内AI更新/结构化Skill已选。点击执行的用户消息带$ui-review-a，真实返回CEDAR-SKILL-15。
- UI_QUICK_COMMENT_15只评价另一Prompt好用，AI仅询问是否保存。只读对比quick_actions完整行（包括版本、更新时间）前后完全一致，仍1条。
- UI_QUICK_NAMING_15明确说“把…沉淀成快捷指令”但不指定名称，引用$ui-review-b。AI自动命名“UI · README Marker 检查”，保存quick_action_mwg5vo5g_iy871m。展开本轮唯一命令确认只读取SKILL.md，不执行README检查内容。工具箱/设置中共2条。
- 将临时Workspace的ui-review-a目录移至本轮隔离备份路径；Skills点击刷新后搜索ui-review只剩b（127总数）。快捷设置明确列出“以下Skill已失效：ui-review-a”及“需修复”；Demand工具箱对应按钮disabled，title指出修复入口和Skill名。native-skill-missing-professional.jpg已保存并实际查看。
- 设置中移除失效引用，选择ui-review-b并同步修正Prompt，保存→刷新。工具箱按钮立即可执行；同一指令实际执行带$ui-review-b并回复CEDAR-SKILL-15。设置回看为v2/由设置页更新，b已选；没有重建指令。验证后已恢复ui-review-a原文件。
- E2E-017/018根据此前UI/队列/附件证据及本轮真实模型与文件证据标PASS。没有产品代码修改，未触及用户真实Skill、仓库或外部消息。


## 第十六轮追加证据：安装执行窗口
- 真实任务201.948秒完成执行，但Codex拒绝向.agents落盘；目标SKILL.md不存在。原生Thread 01a1d940-85eb-75c2-9a64-b94fa0b0f203。无权限扩展、无外部发送，不能计真实安装成功。
- 实际收起/重开与手动暂停成功；最新构建验证暂停中→已暂停、键盘焦点回关闭、Esc回摘要；刷新不残留运行态。内层诊断默认折叠，Enter可展开查看，命令与回复仍保留顺序。仅展示层处理三种诊断类型，事件源和业务状态未变。
- 新增诊断可访问性与终态无spinner行为测试。verify-install-meta退出0，server263/web179/types/build；既有bundle大小提示。git diff --check通过。
- 820长来源曾挤压状态文字竖排，修正后375/820/1440无横向溢出；三主题都已实际查看。新增截图：skill-install-professional-mobile.jpg、skill-install-professional-tablet.jpg、skill-install-midnight-diagnostics.jpg。console warn/error为空，API无新增错误。


## 第十七轮：Workspace原生权限与并行附件
- 并行A/B独立草稿图片切会话恢复、Alt/三列拖动后身份不变、外部松手取消已验；截图parallel-attachments-midnight.jpg。中途Escape和边缘持续悬停当前工具不支持；仅既有单测覆盖，不能计全浏览器PASS。
- 实际Workspace会话conversation_mwg6w93b_l66vws读取根/Repo AGENTS、唯一代码标记、知识事实、Workspace外合成哨兵、Git版本与Codex登录状态。YOLO写入两文件成功；只读shell写入实际operation not permitted且无文件；两模式本机HTTP401。结构化ui-review-b返回README标记。
- Normal实际命令审批：批准根文件写入成功；拒绝目录外写入后命令failed/文件不存在；后续本机HTTP批准并返回401。375松林审批卡截图workspace-approval-forest-mobile.jpg已查看，按钮和正文未溢出。没有扩大权限；三模式原生turn_context与UI选择一致。
- 两Workspace会话重命名/切换/刷新，原历史9个article与Normal保持，新会话YOLO且空历史，URL无Demand。权限/Git/服务重启与删除的完整用例仍保持NOT RUN，不用局部子项替代整条PASS。

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


## 第十九轮：停止、失败恢复、取消和最终清理
- 上一 UI 目标轮有临时夹具准备进展；中间 main/master 问答仅核对 Git 状态。本轮 API93285 与真实API68229已确认存活，无因超时重启。
- UI_UPSTREAM_19：看到 provider retry 1/5→终态失败，浏览器仍显示已连接；控制夹具恢复后点击重试一次，只新增一个成功回合。原失败回合保留；刷新两次尝试仍各一次。API93285/Runtime94898在全程PID及启动时间不变。没有证明真实HTTPS fallback，错误文案如表所述。
- PAUSE_E2E UI_STOP_19：执行中工具展开→点击停止→单个cancelled工具卡、空输入框可继续；刷新不回running。夹具原生history持久化interrupted；刷新后未保留未完成工具条目，未将它冒充真实Codex工具历史证据。
- UI19 · 取消确认验收（f0586784-731c-4e1b-bfdb-ce2cdf9d7df6）：后台fork准备导致v1过期，暂停得到revision conflict与刷新提示；刷新v2后暂停v3、恢复v4、首次取消显示确认、第二次取消v5；新Tab仍已取消，运行记录0。
- UI19 · 待处理结果验收（30eea767-b93a-4578-90f2-ba06f0b4efe8）：立即运行产生一次bf39d906-556c-48ea-bc4c-252ad9a56d5a记录，状态“待人工处理”，通知“已保存到站内”；小铃铛显示“需要处理”和独立“飞书：未开启”。随后显式取消，最终全部跟进为4completed/2cancelled，无活动Turn。
- notification-attention-midnight.jpg为稳定1440×1000截图，已查看并替换resize过渡帧；document宽1440，无横向溢出。
- 移除Workspace先取消确认再实际移除；全部登记移除后页面回到创建Workspace空态，刷新稳定。剩余磁盘清理与原生Thread归档见本报告清理节。没有本轮产品代码改动，沿用最后一次绿色完整verify。
