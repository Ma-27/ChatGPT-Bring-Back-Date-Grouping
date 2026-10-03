# ChatGPT Bring Back Date Grouping

一个面向新版 ChatGPT Web 的 userscript 维护仓库，用于在侧栏历史记录中恢复按日期分组显示。

本仓库是一个公开维护分支，目标是继续兼容 ChatGPT 前端改版后的页面结构，同时保留并尊重原始脚本的作者署名、来源信息与许可声明。

## 项目状态

- 当前脚本文件：`ChatGPT Bring Back Date Grouping.user.js`
- 当前适配目标：新版 `chatgpt.com` 左侧历史栏
- 当前分组依据：对话 `update_time`
- 当前验证方式：隔离 DOM 自动化回归测试，以及基于本机浏览器登录态的页面注入验证

#### 2026-10-03 跨设备编码与项目会话分组修正（2.5.7）

可安装的 `.user.js` 源文件统一使用 ASCII：注释为英文，运行时中文日期标签使用 JavaScript Unicode 转义，
例如 `\u4eca\u5929` 运行后仍显示“今天”。工程源码可直接分发，不再需要另行转换安装副本。
这解决了文件传输或导入时中文被错误解码的问题，分组逻辑保持不变。

同时修正“最近”列表中的项目/GPT 会话链接识别：除了 `/c/会话ID`，还识别
`/g/项目或GPT标识/c/会话ID`，并支持对应的 ChatGPT 绝对地址。
旧实现会漏掉这类会话，即使日期数据已存在，也不会插入对应分组标题。
修复仅作用于历史区域内的会话，不改动独立的项目或置顶区域。

已追溯 Git 中从最早导入的 2.5.2（`eff2ae7`）到 2.5.6（`5354565`）的全部脚本版本，
包括 2.5.5（`947bf2b`），有效时间戳的日期标签规则一致，没有两个月上限：
支持今天、昨天、2～6 天前、上周、2 周前、上个月、按日历月差显示的月份标签（最多 6 个月前）、
半年前（7～11 个日历月），以及按日历月差计算的整数年前（12 个月及以上）。
分组依据为 `update_time`，不是创建时间。脚本只给页面已挂载且能取得时间信息的会话插入标题，
不负责加载更早的会话行；可见标签范围还取决于页面加载的会话及其日期数据。

#### 2026-09-30 侧栏适配（2.5.6）

新版 Web 将历史栏改为“置顶 / 项目 / 最近”。脚本现在通过
`data-app-action-sidebar-section-heading="Recents"` 定位“最近”区域，
在其中的 `role="list"` 容器内、完整会话行之前插入日期标题。
不依赖“最近”的中文文案或构建生成的样式类名，也不会改动置顶、项目和聊天正文。

侧栏重新展开、窄屏弹出侧栏、会话追加或重排时，会重新计算分组；多个已挂载的
历史区域分别监听，卸载后释放监听器。原有 `#history` 列表仍可使用。

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
- 适配了新版 ChatGPT 侧栏的 `Recents` 区域及其中的完整会话行，保留原有 `#history` 列表支持
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
3. 将脚本内容粘贴到 Tampermonkey 并保存；已安装旧版时，替换原脚本内容，避免同时启用两份。
4. 打开或刷新 `https://chatgpt.com/`。
5. 展开左侧历史栏，检查日期分组是否正常显示。

## 开发与验证

开发环境使用 Node.js 24 或更高版本，先执行 `npm ci` 安装依赖；安装 userscript 本身不需要 Node.js。

本仓库额外提供了几个本地调试脚本：

- `npm run inspect:sidebar`
  用于抓取当前 ChatGPT 侧栏结构和相关缓存信息。
- `npm run verify:grouping`
  用于把当前 userscript 注入浏览器页面，并验证日期分组是否已经恢复。
- `npm test`
  使用隔离 DOM 验证新版侧栏分组、区域隔离、动态增删重排、侧栏重建及缓存更新；
  同时验证刷新请求按帧合并、API 分页游标复用和失败请求排重。

说明：

- `inspect:sidebar` 和 `verify:grouping` 依赖本机已登录的 Chrome 环境；`npm test` 不需要浏览器登录态或网络。
- 产物会输出到 `artifacts/` 目录。
- `artifacts/` 已加入 `.gitignore`，默认不会进入版本库。

## 仓库结构

- `ChatGPT Bring Back Date Grouping.user.js`
  当前维护中的 userscript 主文件
- `tools/inspect-chatgpt-sidebar.mjs`
  抓取侧栏结构与缓存信息的调试脚本
- `tools/verify-date-grouping.mjs`
  注入并验证分组效果的验证脚本
- `tools/sidebar-dom.mjs`
  两个调试入口共用的侧栏定位与展开逻辑
- `tests/sidebar-dom.test.mjs`
  根据实际页面层级编写的 DOM 回归测试（使用虚构会话，不需要登录态）
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
