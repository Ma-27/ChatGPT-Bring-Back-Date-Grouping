// ==UserScript==
// @name        ChatGPT bring back date grouping
// @version     2.5.3
// @author      tiramifue
// @description Brings back the date grouping on chatgpt.com
// @match       https://chatgpt.com/*
// @run-at      document-end
// @namespace   https://greasyfork.org/users/570213
// @license     Apache-2.0
// @grant       GM_addStyle
// @noframes
// @downloadURL https://update.greasyfork.org/scripts/538829/ChatGPT%20bring%20back%20date%20grouping.user.js
// @updateURL https://update.greasyfork.org/scripts/538829/ChatGPT%20bring%20back%20date%20grouping.meta.js
// ==/UserScript==

// updated 2026-03-27

(function () {
    'use strict';

    // 这些选择器对应 2026-03 的新版 ChatGPT 侧栏结构。
    const HISTORY_ROOT_SELECTOR = '#history';
    const CONVERSATION_SELECTOR = 'a[href^="/c/"]';
    const HEADER_SELECTOR = '.__chat-group-header';
    const HISTORY_CACHE_SUFFIX = '/conversation-history';

    GM_addStyle(`
.__chat-group-header {
    list-style: none;
    padding: 6px 10px 4px;
    padding-left: var(--__chat-group-padding-left, 10px);
    font-size: 0.72rem;
    line-height: 1.2;
    color: var(--text-secondary, #6b7280);
    user-select: none;
    pointer-events: none;
}
    `);

    /**
     * 将 ISO 时间映射为中文分组标签。
     * 这里仍然按“最近更新时间”来分组，和旧脚本的语义保持一致。
     * @param {string} isoString ISO 时间字符串
     * @returns {string|null} 分组标签
     */
    function getDateGroupLabel(isoString) {
        if (!isoString) return null;

        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) return null;

        const now = new Date();
        const msInDay = 24 * 60 * 60 * 1000;
        const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const daysAgo = Math.floor((nowStart - dateStart) / msInDay);
        const monthsAgo = (nowStart.getFullYear() - dateStart.getFullYear()) * 12 + (nowStart.getMonth() - dateStart.getMonth());

        if (daysAgo <= 0) return '今天';
        if (daysAgo === 1) return '昨天';
        if (daysAgo <= 6) return `${daysAgo}天前`;
        if (daysAgo <= 13) return '上周';
        if (daysAgo <= 20) return '2周前';
        if (daysAgo <= 31) return '上个月';
        if (monthsAgo <= 6) return `${monthsAgo}个月前`;
        if (monthsAgo <= 11) return '半年前';
        const yearsAgo = Math.floor(monthsAgo / 12);
        return `${yearsAgo}年前`;
    }

    /**
     * 从 href 中提取对话 ID。
     * @param {HTMLAnchorElement} node 对话链接节点
     * @returns {string|null} 对话 ID
     */
    function getConversationIdFromNode(node) {
        if (!(node instanceof HTMLAnchorElement)) return null;

        const href = node.getAttribute('href') || '';
        const match = href.match(/^\/c\/([^/?#]+)/);
        return match ? match[1] : null;
    }

    /**
     * 解析单个 localStorage 缓存项。
     * ChatGPT 会把历史记录按分页缓存到 `conversation-history` 键里。
     * @param {string|null} rawValue 原始缓存字符串
     * @returns {Array<object>} 历史会话数组
     */
    function parseConversationHistoryEntry(rawValue) {
        if (!rawValue) return [];

        try {
            const payload = JSON.parse(rawValue);
            const pages = Array.isArray(payload?.value?.pages) ? payload.value.pages : [];
            return pages.flatMap(page => Array.isArray(page?.items) ? page.items : []);
        } catch (error) {
            console.warn('ChatGPT grouping: failed to parse conversation history cache.', error);
            return [];
        }
    }

    /**
     * 汇总所有可见 workspace/account 的历史缓存，并按对话 ID 建索引。
     * 如果同一个对话在多个缓存中出现，则保留更新时间更晚的版本。
     * @returns {Map<string, object>} 对话元数据索引
     */
    function loadConversationIndex() {
        const conversationIndex = new Map();

        for (let index = 0; index < localStorage.length; index += 1) {
            const storageKey = localStorage.key(index);
            if (!storageKey || !storageKey.endsWith(HISTORY_CACHE_SUFFIX)) continue;

            const items = parseConversationHistoryEntry(localStorage.getItem(storageKey));
            for (const item of items) {
                if (!item?.id || !item?.update_time || item?.is_archived) continue;

                const previous = conversationIndex.get(item.id);
                if (!previous) {
                    conversationIndex.set(item.id, item);
                    continue;
                }

                const previousTime = new Date(previous.update_time).getTime();
                const nextTime = new Date(item.update_time).getTime();
                if (nextTime > previousTime) {
                    conversationIndex.set(item.id, item);
                }
            }
        }

        return conversationIndex;
    }

    /**
     * 获取新版历史列表真正承载条目的容器。
     * 目前 `#history` 下方是一个 `ul`，但这里保留轻量兼容写法。
     * @param {HTMLElement} historyRoot 历史根节点
     * @returns {HTMLElement|null} 可渲染分组头的容器
     */
    function getRenderableHistoryContainer(historyRoot) {
        if (!(historyRoot instanceof HTMLElement)) return null;
        return historyRoot.querySelector('ul') || historyRoot;
    }

    /**
     * 获取应当插入分组头之前的“行”节点。
     * 新版结构中对话链接位于 `li > a`，因此优先回退到 `li`。
     * @param {Element} node 对话链接节点
     * @returns {Element} 作为插入锚点的行节点
     */
    function getConversationRow(node) {
        return node.closest('li') || node;
    }

    /**
     * 删除上一轮渲染留下的分组头，避免重复堆叠。
     * @param {HTMLElement} historyRoot 历史根节点
     */
    function clearGroupedChats(historyRoot) {
        historyRoot.querySelectorAll(HEADER_SELECTOR).forEach(element => element.remove());
    }

    /**
     * 根据首个会话标题的缩进，调整分组头的左边距。
     * 这样分组头能和新版侧栏标题列保持视觉对齐。
     * @param {HTMLElement} historyRoot 历史根节点
     * @param {HTMLElement} container 分组头的插入容器
     */
    function syncGroupHeaderPadding(historyRoot, container) {
        const firstAnchor = historyRoot.querySelector(CONVERSATION_SELECTOR);
        if (!(firstAnchor instanceof HTMLElement)) return;

        const titleElement = firstAnchor.querySelector('span[dir="auto"], .truncate, span') || firstAnchor;
        if (!(titleElement instanceof HTMLElement)) return;

        const titleRect = titleElement.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const paddingLeft = Math.max(10, Math.round(titleRect.left - containerRect.left));
        container.style.setProperty('--__chat-group-padding-left', `${paddingLeft}px`);
    }

    /**
     * 创建分组头节点。
     * 当容器是 `ul` 时使用 `li`，避免破坏列表结构。
     * @param {HTMLElement} container 分组头容器
     * @param {string} label 分组文案
     * @returns {HTMLElement} 分组头节点
     */
    function createGroupHeader(container, label) {
        const tagName = container.tagName === 'UL' ? 'li' : 'div';
        const header = document.createElement(tagName);
        header.className = '__chat-group-header';
        header.textContent = label;
        header.setAttribute('role', 'presentation');
        return header;
    }

    /**
     * 按当前 DOM 顺序重建分组头。
     * 新版页面已经负责排序，我们只需要根据缓存中的 `update_time` 决定组边界。
     * @param {HTMLElement} historyRoot 历史根节点
     */
    function renderGroupedChats(historyRoot) {
        const observer = historyRoot.__chatObserver;
        if (observer) observer.disconnect();

        clearGroupedChats(historyRoot);

        const container = getRenderableHistoryContainer(historyRoot);
        if (!(container instanceof HTMLElement)) {
            if (observer) observer.observe(historyRoot, { childList: true, subtree: true });
            return;
        }

        syncGroupHeaderPadding(historyRoot, container);

        const conversationIndex = loadConversationIndex();
        let lastLabel = null;

        container.querySelectorAll(CONVERSATION_SELECTOR).forEach(node => {
            const conversationId = getConversationIdFromNode(node);
            const conversation = conversationId ? conversationIndex.get(conversationId) : null;
            const label = getDateGroupLabel(conversation?.update_time || null);

            // 如果当前条目在缓存里还没有时间信息，就直接跳过，不做猜测性分组。
            if (!label) return;

            if (label !== lastLabel) {
                const row = getConversationRow(node);
                if (row.parentNode) {
                    row.parentNode.insertBefore(createGroupHeader(container, label), row);
                    lastLabel = label;
                }
            }
        });

        if (observer) observer.observe(historyRoot, { childList: true, subtree: true });
    }

    let renderTimer = null;

    /**
     * 对频繁的 DOM 变化做一次轻量防抖，减少重复重排。
     */
    function queueRender() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            const historyRoot = document.querySelector(HISTORY_ROOT_SELECTOR);
            if (historyRoot instanceof HTMLElement) {
                renderGroupedChats(historyRoot);
            }
        }, 120);
    }

    /**
     * 监听历史列表的节点变化。
     * 新版侧栏展开、搜索、置顶等操作都会触发这里的重渲染。
     * @param {HTMLElement} historyRoot 历史根节点
     */
    function observeChatList(historyRoot) {
        const observer = new MutationObserver(() => {
            queueRender();
        });

        observer.observe(historyRoot, { childList: true, subtree: true });
        historyRoot.__chatObserver = observer;
    }

    /**
     * 监听 localStorage 中的历史缓存更新。
     * 同页内写入不会触发 `storage` 事件，因此额外补一个原型级别的拦截。
     */
    function installHistoryCacheListeners() {
        window.addEventListener('storage', event => {
            if (typeof event.key === 'string' && event.key.endsWith(HISTORY_CACHE_SUFFIX)) {
                queueRender();
            }
        });

        if (Storage.prototype.__chatGroupingPatched) return;

        const originalSetItem = Storage.prototype.setItem;
        const originalRemoveItem = Storage.prototype.removeItem;

        Storage.prototype.setItem = function (key, value) {
            const result = originalSetItem.apply(this, arguments);
            if (this === localStorage && typeof key === 'string' && key.endsWith(HISTORY_CACHE_SUFFIX)) {
                queueRender();
            }
            return result;
        };

        Storage.prototype.removeItem = function (key) {
            const result = originalRemoveItem.apply(this, arguments);
            if (this === localStorage && typeof key === 'string' && key.endsWith(HISTORY_CACHE_SUFFIX)) {
                queueRender();
            }
            return result;
        };

        Storage.prototype.__chatGroupingPatched = true;
    }

    /**
     * 持续等待新版侧栏挂载。
     * 侧栏收起和重新展开时会重建 `#history`，因此这里要长期监听。
     */
    (function watchSidebar() {
        let lastHistoryRoot = null;

        function setup(historyRoot) {
            if (!(historyRoot instanceof HTMLElement) || historyRoot === lastHistoryRoot) return;

            lastHistoryRoot = historyRoot;
            observeChatList(historyRoot);
            queueRender();
            console.log('ChatGPT grouping: sidebar attached.');
        }

        installHistoryCacheListeners();

        const rootObserver = new MutationObserver(() => {
            const historyRoot = document.querySelector(HISTORY_ROOT_SELECTOR);
            if (historyRoot instanceof HTMLElement) {
                setup(historyRoot);
                queueRender();
            }
        });

        rootObserver.observe(document.body, { childList: true, subtree: true });

        const historyRootNow = document.querySelector(HISTORY_ROOT_SELECTOR);
        if (historyRootNow instanceof HTMLElement) {
            setup(historyRootNow);
        }
    })();
})();
