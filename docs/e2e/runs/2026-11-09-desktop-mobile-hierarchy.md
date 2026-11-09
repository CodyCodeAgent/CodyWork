# CodyWork E2E 回归记录：桌面层级与移动端布局

- 日期：2026-11-09
- 执行者：Codex
- 代码 revision：`feat/responsive-workbench`，基于 `0e13ac4ebf12a551fe7616f48d5f95ee53ad317c` 的未提交修改（PR #6）
- Core 版本：v0.43.1，未修改
- 环境与 URL：生产构建，`http://127.0.0.1:43328/`；未访问线上服务
- 浏览器与视口：IAB；1600×1000、1280×900、820×1180、390×844、375×812、844×390
- SQLite 数据库：`/tmp/codywork-inbox-e2e.YkjTcg/fixture.db`，隔离合成数据
- 测试 Workspace：`ws_inbox`；Demand `demand_inbox`；来源 `conversation_inbox`，第二会话 `conversation_other`

## 结论

桌面与移动端关键布局和正常对话路径已验证。完整 E2E 用例仍有未执行分支，以下按实际覆盖记录，不将局部覆盖计为整条 PASS。尚未提交、推送、合并或部署。

使用 ui-ux-pro-max 的层级、对比度、可访问性和响应式指导：桌面恢复深色导航、浅色工作区，操作直接展示；手机保留原生 dialog 抽屉与单一 Core Composer/Conversation。没有修改协议、消息状态或后端。

## 用例结果

| 用例 / 验证范围 | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| E2E-001 正确登录、Workspace 恢复、有效登录持久化、第二 Tab | PASS | 临时密码登录后进入测试 Workspace；刷新及另开 Tab 无重复登录，实时连接成功 | 错误密码分支 NOT RUN，整条用例未完整覆盖 |
| E2E-004 深链接、刷新与会话选择 | PASS | Demand/Conversation URL 恢复相同需求与历史；手机切换第二会话更新 URL | 概览与 Demand 的浏览器前进/后退分支 NOT RUN |
| E2E-007 发送立即展示、正式历史收敛 | PASS | `SLOW_E2E desktop-mobile-review-1` 发送后先显示唯一用户气泡及发送状态，完成后仍一条；重启后历史保留 | 启动失败及失败 outbox 重试分支 NOT RUN |
| E2E-008 正常多轮顺序与去重 | PASS | 第二会话完成 review-1、review-2；最终构建重启后发送 review-3，两 Tab 各出现一次且顺序正确 | 工具与实时 overlay 的所有边界组合、第四轮 NOT RUN；工具卡片另用合成历史检查 |
| E2E-011 正常实时跨 Tab 与重启恢复 | PASS | 第二 Tab 发送 review-3，第一 Tab 无刷新收到一次；重启后原有两轮历史及连接恢复 | 全部异常恢复分支 NOT RUN |
| E2E-016 本轮布局与健康检查 | PASS | 六种视口无文档横向溢出；桌面操作可见；手机抽屉 Escape 关闭并恢复焦点；横屏 Composer 保持在视口内 | 最终浏览器 warn/error 均为空；隔离服务未观察到运行异常 |
| E2E-006 移动导航与历史会话抽屉 | PASS | 项目导航、会话详情及历史入口均可打开；选择会话自动收起；Escape 返回入口焦点 | 新建、重命名、删除及多 Demand 管理 NOT RUN |
| E2E-013 / E2E-014 富文本与工具展示 | PASS | 合成原生 Thread 历史中标题、段落、三行表格、列表、工具折叠卡显示正确；桌面与手机验证 | 合成 fixture 不是实际模型或业务结果；图片上传/预览、完整 Mermaid 分支 NOT RUN |
| E2E-017 Composer 设置展示 | PASS | 手机展开“设置 · Normal”可见原 Core 控件，再次收起；不修改权限 | 设置持久化和 Skill/快捷指令全流程 NOT RUN |

## 发现并修复的问题

1. 全局浅灰导航与小字号导致主次层级不足：恢复深色导航面板和较清晰的字号、选中态与对比度。
2. 桌面操作藏在手机式 disclosure 中：改成常驻操作区，窄桌面自动换行；手机继续复用上下文抽屉。
3. 桌面对话限制 840px，剩余空间过大：会话和输入区统一最大 1120px，保留适度阅读边距。
4. 浏览器实测发现旧样式的 assistant body 宽度与新卡片冲突，部分文字溢出卡片：显式设 `width: 100%; min-width: 0`；最终构建下 1600px 视口 body 与消息内容区均为 955px，手机无横向溢出。

## 未解决问题与阻塞

没有观察到本轮改动导致的功能故障。上表列出的 NOT RUN 分支仍未覆盖，不能将本报告视为完整产品回归通过。没有真实外部模型或飞书发送；原生协议执行使用仓库的 fixture，未调用外部服务。

## 健康检查

- `pnpm verify`：最终修改后通过；254 项服务端测试 + 140 项前端测试，共 394 项，类型检查与构建通过。
- 浏览器 console error/warn：最终页面采集为空。
- 服务端异常日志：仅启动信息和既有实验性依赖提示，未观察到本轮请求异常。
- 刷新/重连：最终构建重启后两轮历史恢复、第三轮跨 Tab 同步，无重复用户消息或残留运行状态。
- [桌面截图](assets/2026-11-09-desktop-workbench.png)
- [手机截图](assets/2026-11-09-mobile-workbench.png)

## 清理

关闭两个 agent 创建的临时浏览器 Tab，重置 viewport override；停止端口 43328 的隔离服务。一次性数据库、Workspace、Worktree、原生协议状态和服务脚本随临时根目录移入本机废纸篓，保留可恢复性。未修改或清理真实用户 Workspace，未触碰生产数据。
