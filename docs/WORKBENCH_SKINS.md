# CodyWork 皮肤

设置 → 工作台外观。选中卡片立即应用；所有设置保存在当前浏览器、当前站点，跨标签页同步。不会修改 Workspace、Demand、Runtime 或其他用户的配置。换设备或清理浏览器前可导出 `.cody-skin` 备份。

## 内置与定制

- 清爽专业、深色科技、松林手记保留原有语义配色与单一明暗模式。
- QQ 2007 提供浅色、深色和跟随系统，含蓝银色窗框、经典导航、立体控件、会话边线与头像。
- 支持强调色、紧凑/舒适/宽松密度、恢复当前皮肤默认值。
- 自定义皮肤可导出、重新导入、确认删除。内置皮肤不能删除；导入同 ID 包会创建副本，不覆盖现有皮肤。

## 图片生成

选择或拖入 PNG/JPEG/WebP（最多 15 MB、4000 万像素）。浏览器提取配色、压缩 WebP 背景至 480 KB 以内，生成浅色和深色版本。可调整名称、默认模式、模糊、遮罩、饱和度、位置。预览不改变当前外观，保存并应用后才生效。没有调用图像模型，也没有上传给服务端。

生成器、Skin API 和 QQ 配方改编自 CodyWeb `97c97db`，MIT 许可保留于 `apps/workbench-web/src/skins/LICENSE.CodyWeb`。Work 的页面组件、会话控件、表格、Mermaid 白底、审批以及并行开发布局由自己的语义样式适配，不复制 CodyWeb 页面和布局控制器。

## 皮肤包

支持 CodyWeb Skin API v1（单套 tokens）与 v2（light/dark variants）。保留 manifest、tokens、recipes、assets、syntaxTheme、terminalTheme、chartPalette。后三项保留用于格式互通，Workbench 没有独立终端/图表主题选择器；当前会话代码块由 Work 的 code 角色适配。

Work 导出包可选含 `workbench` 语义角色扩展，保证原有三套主题导出再导入不会丢失导航、状态色等细节。外部没有此扩展的包通过 `workbenchSkinVariables` 适配。此扩展仅接受白名单角色，不能注入选择器或样式表。

包最大 1.5 MB，每个内嵌栅格资源最多 512000 bytes。不接受 SVG、脚本、远程图片、服务器本地路径或 CSS 资源请求。CodyWeb 包若引用 `/codex-api/theme-assets/...` 或 `/skin-assets/...`，需在来源端将图片嵌入后导入；不能将另一个站点的相对路径误认为当前站点文件。Work 导出始终自包含，包括 QQ 头像。

## 保存与失败处理

`codywork.skins.v1` 保存单个版本化快照（preferences + 自定义 skins）；保留 `codywork.theme` 用于原版本迁移。新包先校验、再持久化、最后应用，配额不足不会留下半导入记录。最多 40 个自定义皮肤，实际容量取决于浏览器存储配额。失败提示建议导出并删除不用的皮肤。普通外观切换在禁用存储时仍可临时使用，但显示不能保存的提示。

只缓存无图片的调色变量至 `codywork.skin-paint.v1`，用于应用启动与登录页预绘制。缓存不是配置来源，不包含可执行代码或资源 URL。系统明暗变化仅在支持双模式且选中“跟随系统”时切换。

## 实现边界

- `skins/themeRegistry.ts`：纯解析、v1 迁移、校验与模式选择。
- `skins/imageSkinGenerator.ts`：本地图片处理与双模式配色。
- `skins/workbenchSkin.ts`：可移植 tokens 到 Work 的语义角色映射。
- `theme.ts`：当前浏览器存储、迁移、多标签页同步、资源惰性加载。
- `ThemePicker` / `ImageSkinStudio` / `SkinPreview`：产品界面。
- `skin-recipes.css`：页面外观与 Core 嵌入式会话 CSS 适配，不更改 Core 原生消息或执行协议。
