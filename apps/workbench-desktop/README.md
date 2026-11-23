# CodyWork Desktop

macOS 14 或更新版本。桌面端用独立窗口打开已部署的 CodyWork。登录、Workspace、会话、Git 和 Runtime 由所选服务器提供。

## 使用

1. 打开 `CodyWork.app`，在「服务器连接」填写连接名称和 CodyWork 根地址。可以先点「测试连接」。
2. 点击「保存并打开」，在工作台窗口使用该服务器现有的登录方式。
3. 通过应用菜单的「服务器连接…」或 `⌘,` 添加、编辑、移除或切换连接。第一台成功连接的服务器会成为默认项，之后可在列表里选择「设为默认」。重启时优先连接默认项，连接不上时回到设置。
4. `⌘R` 刷新工作台。服务器执行中的任务可以在关掉桌面窗口后继续运行。

公网使用 HTTPS。私有 IP、回环和 `.local` 地址也支持 HTTP。不同服务器的 WebKit 数据存储独立，登录凭据由原有网页认证处理。

## 构建

在 macOS 安装 Xcode 命令行工具、Rust 和 Node.js。从仓库根目录执行：

```sh
cd apps/workbench-desktop
npx --yes @tauri-apps/cli@2.12.5 build --ci --bundles app -- --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

应用输出为 `src-tauri/target/release/bundle/macos/CodyWork.app`。默认构建当前 Mac 的架构，并使用临时签名供本机试用。对外分发时通过 Tauri 的 macOS 签名、公证流程构建。

桌面端嵌入的 HTML 只负责本机服务器设置。远程工作台窗口使用配置的服务地址加载现有 Vue 页面。原生设置命令仅对本机设置窗口可用。

## GitHub Actions 试用包

每次 `main` 收到代码，`Package CodyWork for macOS` 都会构建兼容 Apple Silicon 和 Intel 的通用版。打开 [Actions](https://github.com/CodyCodeAgent/CodyWork/actions/workflows/desktop-macos.yml)，选择成功的运行，在 `Artifacts` 下载 `CodyWork-macos-universal-*.zip`。产物保留 30 天，也可以在 Actions 里用 `Run workflow` 重新打包。

ZIP 内是使用临时签名的 `CodyWork.app`。需要向其他 Mac 正式分发时，使用 Apple Developer ID 签名并提交公证。

## 应用内更新

从 macOS 菜单「CodyWork → 检查更新…」或桌面设置的「关于与更新」查看当前版本。启用了更新源的应用启动时会在后台检查。找到新版后会显示版本与更新说明，点击「下载并更新」才会下载、验签、安装并重启。连接配置与服务器上的会话会继续保留。

### 配置签名和发布

1. 发布维护者生成一次 Tauri updater 密钥对，并将私钥备份至受控的位置。使用 `npx --yes @tauri-apps/cli@2.12.5 signer generate --write-keys <安全目录>/codywork-updater.key`。
2. 在 GitHub 仓库的 Actions 设置中，将公钥文件内容放入变量 `CODYWORK_DESKTOP_UPDATER_PUBLIC_KEY`，将私钥文件内容放入 Secret `TAURI_SIGNING_PRIVATE_KEY`。加密私钥同时需要 Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。同一更新渠道应持续使用同一把密钥。
3. 把 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 中的桌面版本号一起更新，并通过 Cargo 刷新对应的 `Cargo.lock`。代码合入 `main` 后，用同版本的 `desktop-vX.Y.Z` tag 发版。建议用 annotated tag 写更新说明，工作流会把说明发布到 Release 和应用更新窗口。

常规 `main` 构建仍上传试用 ZIP。配置公钥后，试用包也可加入更新渠道。版本 tag 会构建通用安装 ZIP、带签名的更新包、`latest.json`，然后随同发布到 GitHub Releases。应用从 Releases 的 `latest.json` 检查版本。Tauri 更新验签和 Apple Developer ID 签名、公证是两套配置；当前工作流使用临时的 macOS 签名。

已经安装的旧版需要手动安装一次带更新功能且内置发布公钥的应用，后续版本即可在应用内升级。
