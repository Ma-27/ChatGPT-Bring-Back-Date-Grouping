# ChatGPT Bring Back Date Grouping

一个面向新版 ChatGPT Web 的 userscript 维护仓库，用于在侧栏历史记录中恢复按日期分组显示。

本仓库是一个公开维护分支，目标是继续兼容 ChatGPT 前端改版后的页面结构，同时保留并尊重原始脚本的作者署名、来源信息与许可声明。

## 项目状态

- 当前脚本文件：`ChatGPT Bring Back Date Grouping.user.js`
- 当前适配目标：新版 `chatgpt.com` 左侧历史栏
- 当前分组依据：对话 `update_time`
- 当前验证方式：基于本机浏览器登录态的页面注入验证

## 来源与致谢

这份仓库维护的脚本并非从零开始编写，而是基于公开流传的原始 userscript 继续维护。

- Reddit 线索来源：
  [r/ChatGPT 评论链接](https://www.reddit.com/r/ChatGPT/comments/1l50i5a/comment/mwnynyv/?context=3)
- 原始脚本下载地址：
  [Greasy Fork update URL](https://update.greasyfork.org/scripts/538829/ChatGPT%20bring%20back%20date%20grouping.user.js)
- 原始脚本页面：
  [Greasy Fork script page](https://greasyfork.org/en/scripts/538829-chatgpt-bring-back-date-grouping/code)

根据原始脚本元数据，原作者为 `tiramifue`。本仓库仅做兼容性维护与工程化整理，不声明原始创作归属，也不移除原脚本中的作者与许可信息。

如果你因为这个仓库而受益，也请优先为原作者保留明确署名，并在传播或二次分发时附带上面的来源链接。

## 这个仓库做了什么

相较于原始公开版本，这个仓库主要增加了以下内容：

- 建立了适合 JetBrains IDE 使用的本地工程目录与 Git 历史
- 保留了一次“原始导入”提交，方便后续追踪差异
- 将脚本从依赖 React Fiber 私有字段的实现，改为读取页面自身的历史缓存
- 适配了新版 ChatGPT 侧栏的 `#history > ul > li > a` 结构
- 增加了本地调试与验证脚本，便于在页面再次改版后快速定位问题

## 工作原理

当前版本不再依赖旧版页面里暴露的 React `conversation` prop，而是优先读取 ChatGPT 页面自身写入的 `localStorage` 历史缓存：

- `conversation-history`

脚本会把缓存中的 `update_time` 与侧栏中对应的会话链接匹配起来，然后在侧栏列表中插入中文日期分组头，例如：

- `今天`
- `昨天`
- `2天前`
- `上周`

这种方式比直接依赖前端内部组件结构更稳定，也更容易在后续页面改版时继续维护。

## 安装方式

1. 安装一个 userscript 管理器，例如 Tampermonkey。
2. 打开仓库中的 `ChatGPT Bring Back Date Grouping.user.js`。
3. 将脚本内容粘贴到 Tampermonkey，新建脚本后保存。
4. 打开或刷新 `https://chatgpt.com/`。
5. 展开左侧历史栏，检查日期分组是否正常显示。

## 开发与验证

本仓库额外提供了几个本地调试脚本：

- `npm run inspect:sidebar`
  用于抓取当前 ChatGPT 侧栏结构和相关缓存信息。
- `npm run verify:grouping`
  用于把当前 userscript 注入浏览器页面，并验证日期分组是否已经恢复。

说明：

- 这些脚本依赖本机已登录的 Chrome 环境。
- 产物会输出到 `artifacts/` 目录。
- `artifacts/` 已加入 `.gitignore`，默认不会进入版本库。

## 仓库结构

- `ChatGPT Bring Back Date Grouping.user.js`
  当前维护中的 userscript 主文件
- `tools/inspect-chatgpt-sidebar.mjs`
  抓取侧栏结构与缓存信息的调试脚本
- `tools/verify-date-grouping.mjs`
  注入并验证分组效果的验证脚本
- `tools/export_chatgpt_cookies.py`
  读取本机 Chrome 中 ChatGPT cookie 的辅助脚本
- `tools/export_recent_chat_url.py`
  读取最近访问的 ChatGPT 对话页地址的辅助脚本

## 许可与署名

原始脚本元数据声明许可证为 `Apache-2.0`。本仓库在继续维护时，应当至少遵守以下原则：

- 保留原作者 `tiramifue` 的署名信息
- 保留原始来源链接
- 不把原始脚本误写成自己独立原创
- 在公开传播、镜像或二次修改时，继续附带许可与归属说明

如果后续你准备把这个仓库长期公开维护，建议在仓库根目录补充正式的 `LICENSE` 与必要的 `NOTICE` 文件，以便公开分发时的边界更清晰。

## 免责声明

- 本仓库不是 OpenAI 官方项目。
- ChatGPT 前端可能随时改版，脚本兼容性不作永久保证。
- 该脚本只修改页面展示方式，不应被理解为对 ChatGPT 服务本身的任何官方扩展或承诺。

