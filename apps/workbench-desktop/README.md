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
