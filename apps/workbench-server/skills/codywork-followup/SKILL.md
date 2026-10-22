---
name: codywork-followup
description: 在 CodyWork 当前会话创建或管理定时跟进，按用户要求定期只读检查并发送结果通知。不用于重新提交业务操作。
---

使用本轮由 CodyWork 提供的「跟进执行桥接」命令。它绑定当前会话，不依赖旧 Thread 是否具有 dynamic tools。不要搜索密码、修改数据库或使用 cron/sleep 替代。

先运行命令的 `list` 操作，读取已有任务及通知默认值。创建需要名称、具体只读检查内容、完成条件、分钟间隔、带时区的 ISO 截止时间。缺少截止时间或完成条件时询问用户，不要编造。结果按通知策略保存到站内小铃铛，不依赖飞书。只有启用额外飞书投递时才需要机器人和接收人企业邮箱；邮箱会由当前应用解析，不要向用户索取或猜测 Open ID。

把用户指定的查询 Skill 名称和实际查询对象写入 prompt，禁止重新提交流程或修改业务数据。通知策略按用户要求：every 每次、change 变化时、terminal 结束时；未指定用 change 并说明。

命令格式：`node <本轮提供的 helper 路径> <本轮提供的 socket 路径> <操作> '<JSON 参数>'`。路径需 shell 引号保护；用户文本含单引号时用安全的 shell 转义或 stdin 文件处理，不要直接拼接。

参数约定（旧会话无需知道 dynamic tool schema）：

- `list`：`{}`，返回 `data.items` 和 `data.notificationDefaults`。
- `create`：`{"name":"检查结果","prompt":"只读查询具体任务；使用用户指定的 Skill","completionCondition":"全部完成","intervalMinutes":10,"deadlineAt":"2026-10-22T22:00:00+08:00","notificationPolicy":"change","feishuEnabled":false}`。替换为用户实际目标和未来截止时间，例子日期不是默认值。只收站内通知用 `feishuEnabled:false`；额外发飞书用 `feishuEnabled:true`、`accountId`、`recipientEmail`，或继承 list 返回的已保存默认值。不要自行开启用户未要求的外部投递。
- `update`：`{"taskId":"实际 ID","expectedRevision":3,"intervalMinutes":20}`。仅包含用户要求修改的字段；其余字段与 create 同名。
- `pause`、`resume`、`cancel`、`run_now`：`{"taskId":"实际 ID","expectedRevision":3}`。先 list 取最新 revision；版本冲突后重新读取，不盲目覆盖。

不要传 workspaceId、conversationId 或原生 Thread ID，它们由服务端绑定。所有响应外层为 `{"ok":true,"data":...}` 或 `{"ok":false,"error":"..."}`；创建任务位于 `data.task`，任务 ID 是 `data.task.id`。

成功回执必须包含实际返回的任务 ID、间隔、截止时间、完成条件和通知策略，并提示可在「设置 → 定时跟进」查看。没有成功响应就不能声称已安排。连接失效时停止，要求用户在新一轮重新指定此 Skill；不要反复重试写入。
