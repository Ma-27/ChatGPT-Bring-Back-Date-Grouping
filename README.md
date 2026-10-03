# ChatGPT Bring Back Date Grouping

一个面向新版 ChatGPT Web 的 userscript 维护仓库，用于在侧栏历史记录中恢复按日期分组显示。

本仓库是一个公开维护分支，目标是继续兼容 ChatGPT 前端改版后的页面结构，同时保留并尊重原始脚本的作者署名、来源信息与许可声明。

## 项目状态

- 当前脚本文件：`ChatGPT Bring Back Date Grouping.user.js`
- 当前适配目标：新版 `chatgpt.com` 左侧历史栏
- 当前分组依据：对话 `update_time`
- 当前验证方式：隔离 DOM 自动化回归测试，以及基于本机浏览器登录态的页面注入验证

#### 2026-10-03 滚动加载旧会话的日期修正（2.5.8）

2.5.7 修复了项目链接，但没有修复日期数据缺失。Mac Chrome 实页复现中，
`conversation-history` 只有 28 条、最早到 2026-08-14；侧栏已加载的会话远多于缓存。
脚本现有历史接口请求返回 HTTP 200，但 `items=[]`、`total=0`；移除归档/置顶过滤参数后仍相同。
这是本次请求方式在当前页面的实测结果，不能据此断言服务端没有旧会话。

比较后采用页面已提交的 React 会话数据：

| 路径 | 本次结果与取舍 |
| --- | --- |
| 继续读取 localStorage | 日期覆盖不足，不能支持滚动加载的旧会话 |
| 现有 API 与去掉过滤的请求 | 均返回空目录，无法补全日期；不继续猜测接口参数 |
| 监听网络响应 | 需要额外处理请求协议及脚本启动前已加载的数据，本次不采用 |
| 读取已挂载会话的 React 数据 | 实测每条行均能匹配日期；不新增历史请求，采用此方案 |

Git 最早版本 2.5.2（`eff2ae7`）也是读取 `conversation.update_time`，从 2.5.3
（`b252b80`）开始改读缓存。2.5.8 恢复这一数据来源，并保留新版 Recents、项目链接及跨设备编码修正。
DOM 保存的 fiber 指针可能属于旧树，因此先合并各会话行的新旧祖先路径，再从 `FiberRoot.current`
沿已提交的子节点关系读取。只遍历与侧栏行相关的路径，不扫描聊天正文，不按日期新旧猜测当前树。

滚动新增行通过 MutationObserver 刷新；无 DOM 变化的 React prop 更新在页面可见时每秒检查。
相同帧的请求合并，分组未变化时不重建标题。移除了缓存轮询、Storage 原型修改和补全 API。
安装脚本使用 `@grant none` / `@sandbox raw`，以页面上下文读取 React 数据；样式使用原生 style 元素。
运行上下文语义见 [Tampermonkey 文档](https://www.tampermonkey.net/documentation.php?locale=en#meta:sandbox)。

自动化覆盖旧记录滚动加载、缓存不完整、React current/alternate 切换、bailout 共用子树、
脱离当前树、无 DOM 变化的日期更新、标题复用、新旧侧栏及项目链接。
这些测试使用虚构数据。Mac Chrome 实页临时运行完整逻辑后，连续滚动加载至 539 条，
最早会话日期为 2025-10-20，自动出现“半年前”和“1 年前”。验证代码仅去除源码注释及行首空白，
未改动可执行逻辑。实页截图在 `artifacts/2.5.8-live-year-group.png`。
当前 Tampermonkey 的持久安装仍需替换为 2.5.8；iPad Safari 的新版本安装运行仍需设备验证。

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
- 根据实页证据修正日期数据来源；2.5.8 从已提交的 React 会话读取日期，避免不完整缓存截断分组
- 适配了新版 ChatGPT 侧栏的 `Recents` 区域及其中的完整会话行，保留原有 `#history` 列表支持
- 增加了本地调试与验证脚本，便于在页面再次改版后快速定位问题

## 工作原理

当前版本读取实际挂载会话的 React `conversation.update_time`，按会话 ID 与行链接精确匹配，
在“最近”列表内插入中文日期标题。日期标签本身没有两个月上限，可显示月份、半年前、1 年前及更远年份。
脚本不负责预加载历史；随着 ChatGPT 自身滚动加载更多行，相应日期分组自动出现。

React 字段属于前端内部实现，未来改版时仍可能需要调整。缺少有效日期时不猜测分组，
也不从其他账号/工作区的缓存推断日期。

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
  使用隔离 DOM 验证新版侧栏分组、区域隔离、动态增删重排、侧栏重建及日期更新；
  同时验证 React 当前树选择、滚动加载旧记录、刷新请求按帧合并和不变标题复用。

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
