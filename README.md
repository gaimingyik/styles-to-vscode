# Styles to VS Code

点击 Chrome DevTools 的 Elements → Styles 中规则右侧的 `文件名:行号`，自动识别本机 Windows 源码路径，通过 `vscode://` 协议打开 VS Code 对应位置。

版本：1.1.0。项目目录和 Webpack 名称均无需预先配置，可用于不同目录、不同盘符的本机项目。

## 首次加载

1. 将本仓库克隆或下载解压到一个长期保留的文件夹，然后在 Chrome 地址栏输入 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的仓库根目录。
4. 关闭项目页面已有的 DevTools，再按 F12 打开。
5. 按 F1 打开 DevTools 设置，在 Preferences（偏好设置）的右侧区域向下滚动，找到 Console 下方的 Extension（扩展程序）分组，将 `Link handling`（链接处理）设为 **Styles to VS Code**。
6. 在设置的 Sources（源代码）分组中勾选 **Enable CSS source maps**（启用 CSS 源代码映射）。
7. 项目需提供 CSS Source Map，按其构建工具在开发环境启用。只有修改项目构建配置时，才需要自行重启开发服务。
8. 回到 Elements → Styles，点击源文件链接。Chrome 首次可能提示“打开 Visual Studio Code？”，选择打开；如果提供“始终允许”，可以按需勾选。

## 更新扩展

修改本目录中的扩展文件后，在 `chrome://extensions` 找到 **Styles to VS Code**，点击卡片上的重新加载按钮，再关闭并重新打开项目页面的 F12。仅更新扩展时，无需重启项目开发服务。

## 定位范围

- 自动识别路径，无需项目名单、项目根目录配置、VS Code 插件、Node 包或额外服务。
- 处理 `.vue`、`.css`、`.scss`、`.sass`、`.less`、`.styl`、`.stylus` 源文件链接；文件不再限定于某个项目或 `src` 目录。
- 直接识别 Windows 绝对路径、`file:///盘符:/...`、Webpack 链接中的绝对路径，以及 Vite 的 `/@fs/盘符:/...` 链接。HTTP 来源支持 localhost、`.localhost`、回环及局域网开发地址。
- 兼容已遇到的 Windows 绝对路径重复、`src/...` 完整目录前缀重复，以及两者混合的 Source Map 地址。重复的绝对路径前缀需与最终文件目录一致。
- 对相对路径，只读取当前页面的资源地址、样式来源标记、Vite 样式文件标记和内联 Source Map 元数据。与某个已知绝对路径唯一匹配时，使用该路径；页面只能推断出一个 `src` 根目录时，也可定位其下的 `src/...` 链接。
- 页面存在多个可能的目录、只有文件名、没有本机路径线索或读取元数据失败时，继续在浏览器内打开。不会使用上一个页面的项目目录。
- 保留 Source Map 提供的行列号。来源需要对应本机文件；容器、远程机器上的路径不会自动转换为本机 Windows 路径。
- `node_modules` 依赖包样式、普通 JS、虚拟模块、编译后的包及不明确的链接继续在 DevTools 内打开。`config.js` 默认保留 `excludeNodeModules: true`。

## 常见问题

- **安装后能删除文件夹吗？** 不能。Chrome 持续从这个目录读取已解压扩展。目录不必在项目内，但使用期间需要保留。移动目录后需在扩展管理页移除旧条目，再从新位置加载。
- **找不到 Styles to VS Code 选项？** 确认扩展已启用，并关闭再打开 DevTools。也可右键样式来源链接，查找“使用 Styles to VS Code 打开”来验证扩展是否已注册。
- **点击后仍留在浏览器内？** 确认已选择 Link handling，并点击规则右侧的源文件链接。点击属性值、浏览器内置的 `user agent stylesheet` 或元素上的内联样式，不会触发源文件跳转。
- **换一个项目要改配置吗？** 不需要。完整的本机源码路径可直接识别；相对路径根据当前页面的元数据识别，信息不足时保留浏览器内打开。
- **Chrome 提示无法打开 VS Code？** 确认 Windows 已安装 VS Code 并注册 `vscode` URL 协议，首次弹窗没有被取消。此扩展不会修改 Windows 协议注册或浏览器策略。
- **行号不正确？** 先确认 Styles 显示的是原始 `.vue` / `.scss` 等文件，而非生成的模块。修改开发配置后需重启你自己的开发服务；仅修改扩展时，重新加载扩展、重新打开 DevTools 并刷新项目页面。
- **需要恢复原来的点击行为？** 将 DevTools 的 Link handling 改回默认选项，或禁用本扩展。

## 项目配置

Vue CLI 项目可以在 `vue.config.js` 中启用开发环境 CSS Source Map：

```js
module.exports = {
  css: {
    sourceMap: process.env.NODE_ENV === "development"
  }
};
```

如果项目已有其他配置，将 `sourceMap` 合并到现有的 `css` 配置中。扩展本身无需安装依赖或构建，也不会自动修改业务项目。

## 自动检查

本机有 Node.js 时，在仓库根目录运行下列独立检查；它使用模拟浏览器 API，不会启动项目或浏览器：

```powershell
node test/verify.cjs
```

也可以在命令末尾传入一个或多个项目的根目录，额外核对这些项目现有的 `src` 源文件路径。

## 接口参考

- [Chrome：资源链接处理程序](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels#method-setOpenResourceHandler)
- [Chrome：当前页面资源和元数据接口](https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow)
- [VS Code：通过 URL 打开文件和行列号](https://code.visualstudio.com/docs/configure/command-line#_opening-vs-code-with-urls)
- [Vue CLI：CSS Source Map](https://cli.vuejs.org/config/#css-sourcemap)
