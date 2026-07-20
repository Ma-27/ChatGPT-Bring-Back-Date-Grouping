// ==UserScript==
// @name        ChatGPT bring back date grouping
// @version     2.5.5
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

// updated 2026-07-20

(function () {
    'use strict';

    // 这些选择器对应 2026-05 的新版 ChatGPT 侧栏结构。
    const HISTORY_ROOT_SELECTOR = '#history';
    const CONVERSATION_SELECTOR = 'a[data-sidebar-item][href*="/c/"], a[href^="/c/"], a[href^="https://chatgpt.com/c/"]';
    const HEADER_SELECTOR = '.__chat-group-header';
    const HISTORY_CACHE_NAME = 'conversation-history';
    const CACHE_POLL_INTERVAL_MS = 1000;
    const API_PAGE_LIMIT = 50;

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
        const match = href.match(/(?:^|https:\/\/chatgpt\.com)\/c\/([^/?#]+)/);
        return match ? match[1] : null;
    }

    /**
     * 判断 localStorage 键是否是 ChatGPT 的会话历史缓存。
     * 新版页面会在键名前拼接 user/workspace，因此不能只比较完整键名。
     * @param {string} storageKey 缓存键
     * @returns {boolean} 是否为会话历史缓存
     */
    function isConversationHistoryCacheKey(storageKey) {
        return storageKey === HISTORY_CACHE_NAME || storageKey.endsWith(`/${HISTORY_CACHE_NAME}`);
    }

    /**
     * 计算字符串的轻量稳定哈希，用于判断缓存内容是否实际变化。
     * @param {string} value 原始字符串
     * @returns {string} 36 进制哈希
     */
    function hashString(value) {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    /**
     * 为所有会话历史缓存生成内容签名。
     * Tampermonkey 沙盒未必能拦截页面主上下文的 setItem，因此需要用签名轮询补齐更新通知。
     * @returns {string} 当前历史缓存签名
     */
    function buildHistoryCacheSignature() {
        const signatures = [];

        for (let index = 0; index < localStorage.length; index += 1) {
            const storageKey = localStorage.key(index);
            if (!storageKey || !isConversationHistoryCacheKey(storageKey)) continue;

            const rawValue = localStorage.getItem(storageKey) || '';
            signatures.push(`${storageKey}:${rawValue.length}:${hashString(rawValue)}`);
        }

        return signatures.sort().join('|');
    }

    /**
     * 从 TanStack Query 风格的分页缓存中提取分页数组。
     * 这里只接受明确的 pages/items 结构，避免把无关缓存误当成会话列表。
     * @param {object} payload 解析后的缓存对象
     * @returns {Array<object>} 分页数组
     */
    function getHistoryPages(payload) {
        if (Array.isArray(payload?.value?.pages)) return payload.value.pages;
        if (Array.isArray(payload?.pages)) return payload.pages;
        return [];
    }

    /**
     * 从分页或扁平缓存中提取会话条目。
     * @param {object} payload 解析后的缓存对象
     * @returns {Array<object>} 历史会话数组
     */
    function getHistoryItems(payload) {
        const pages = getHistoryPages(payload);
        if (pages.length > 0) {
            return pages.flatMap(page => Array.isArray(page?.items) ? page.items : []);
        }

        if (Array.isArray(payload?.value?.items)) return payload.value.items;
        if (Array.isArray(payload?.items)) return payload.items;
        return [];
    }

    /**
     * 将会话条目写入索引。
     * 同一个会话出现多次时，始终保留更新时间最新的版本。
     * @param {Map<string, object>} conversationIndex 对话索引
     * @param {object} item 会话条目
     */
    function upsertConversationIndex(conversationIndex, item) {
        if (!item?.id || !item?.update_time || item?.is_archived) return;

        const previous = conversationIndex.get(item.id);
        if (!previous) {
            conversationIndex.set(item.id, item);
            return;
        }

        const previousTime = new Date(previous.update_time).getTime();
        const nextTime = new Date(item.update_time).getTime();
        if (nextTime > previousTime) {
            conversationIndex.set(item.id, item);
        }
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
            return getHistoryItems(payload);
        } catch (error) {
            console.warn('ChatGPT grouping: failed to parse conversation history cache.', error);
            return [];
        }
    }

    /**
     * 汇总所有可见 workspace/account 的历史缓存，并按对话 ID 建索引。
     * 如果同一个对话在多个缓存中出现，则保留更新时间更晚的版本。
     * @returns {{conversationIndex: Map<string, object>, cacheRevision: string}} 对话索引和缓存版本
     */
    function loadConversationIndex() {
        const conversationIndex = new Map(apiConversationIndex);
        const cacheSignatures = [];

        for (let index = 0; index < localStorage.length; index += 1) {
            const storageKey = localStorage.key(index);
            if (!storageKey || !isConversationHistoryCacheKey(storageKey)) continue;

            const rawValue = localStorage.getItem(storageKey) || '';
            cacheSignatures.push(`${storageKey}:${rawValue.length}:${hashString(rawValue)}`);

            const items = parseConversationHistoryEntry(rawValue);
            for (const item of items) {
                upsertConversationIndex(conversationIndex, item);
            }
        }

        return {
            conversationIndex,
            cacheRevision: cacheSignatures.sort().join('|')
        };
    }

    const apiConversationIndex = new Map();
    let apiFetchInFlight = false;
    let activeApiCatalogState = null;

    /**
     * 为一个明确的历史缓存版本创建 API 目录扫描状态。
     * 已读取的分页和已尝试的缺失 ID 都只属于这个版本，缓存变化后重新建状态。
     * @param {string} cacheRevision 历史缓存版本
     * @returns {object} API 目录扫描状态
     */
    function createApiCatalogState(cacheRevision) {
        return {
            cacheRevision,
            nextOffset: 0,
            total: Infinity,
            exhausted: false,
            attemptedConversationIds: new Set(),
            pendingConversationIds: new Set()
        };
    }

    /**
     * 获取当前缓存版本对应的 API 目录扫描状态。
     * @param {string} cacheRevision 历史缓存版本
     * @returns {object} API 目录扫描状态
     */
    function getApiCatalogState(cacheRevision) {
        if (!activeApiCatalogState || activeApiCatalogState.cacheRevision !== cacheRevision) {
            activeApiCatalogState = createApiCatalogState(cacheRevision);
        }
        return activeApiCatalogState;
    }

    /**
     * 从 ChatGPT 历史接口补齐可见会话的元数据。
     * 同一个缓存版本始终从上次成功读取的 offset 继续，绝不重复扫描已经读取的分页。
     * @param {Set<string>} targetIds 当前可见但缺少时间信息的会话 ID
     * @param {object} catalogState 当前缓存版本的 API 目录扫描状态
     */
    async function fetchMissingConversationMetadata(targetIds, catalogState) {
        let hasNewMetadata = false;

        while (targetIds.size > 0 && !catalogState.exhausted) {
            const offset = catalogState.nextOffset;
            const apiUrl = new URL('/backend-api/conversations', location.origin);
            apiUrl.searchParams.set('offset', String(offset));
            apiUrl.searchParams.set('limit', String(API_PAGE_LIMIT));
            apiUrl.searchParams.set('order', 'updated');
            apiUrl.searchParams.set('is_archived', 'false');
            apiUrl.searchParams.set('is_starred', 'false');

            const response = await fetch(apiUrl.toString(), {
                credentials: 'include'
            });
            if (!response.ok) {
                throw new Error(`history api returned ${response.status}`);
            }

            const payload = await response.json();
            const items = Array.isArray(payload?.items) ? payload.items : [];
            if (Number.isFinite(payload?.total)) {
                catalogState.total = payload.total;
            }

            for (const item of items) {
                const before = apiConversationIndex.get(item?.id);
                upsertConversationIndex(apiConversationIndex, item);
                const after = apiConversationIndex.get(item?.id);
                if (after && after !== before) hasNewMetadata = true;
                if (item?.id) targetIds.delete(item.id);
            }

            // 只有成功解析当前页后才推进游标，网络失败时不会跳过尚未读取的数据。
            catalogState.nextOffset = offset + items.length;
            catalogState.exhausted = items.length === 0 || catalogState.nextOffset >= catalogState.total;
        }

        if (hasNewMetadata) queueRender();
    }

    /**
     * 依次处理当前缓存版本中尚未补齐的会话 ID。
     * 新请求会先进入集合排重；已有请求结束后，再处理期间新增的 ID。
     */
    function processPendingConversationMetadata() {
        if (apiFetchInFlight || !activeApiCatalogState) return;

        const catalogState = activeApiCatalogState;
        const targetIds = new Set(
            [...catalogState.pendingConversationIds].filter(id => !apiConversationIndex.has(id))
        );
        catalogState.pendingConversationIds.clear();

        if (targetIds.size === 0 || catalogState.exhausted) return;

        apiFetchInFlight = true;
        fetchMissingConversationMetadata(targetIds, catalogState)
            .catch(error => {
                console.warn('ChatGPT grouping: failed to fetch conversation metadata.', error);
            })
            .finally(() => {
                apiFetchInFlight = false;
                processPendingConversationMetadata();
            });
    }

    /**
     * 触发缺失元数据的接口补齐。
     * 同一个缓存版本中的每个缺失 ID 只允许进入扫描流程一次。
     * @param {Array<string>} missingConversationIds 当前可见但缺少时间信息的会话 ID
     * @param {string} cacheRevision 当前历史缓存版本
     */
    function requestMissingConversationMetadata(missingConversationIds, cacheRevision) {
        const catalogState = getApiCatalogState(cacheRevision);

        for (const conversationId of missingConversationIds) {
            if (
                !conversationId ||
                apiConversationIndex.has(conversationId) ||
                catalogState.attemptedConversationIds.has(conversationId)
            ) {
                continue;
            }

            catalogState.attemptedConversationIds.add(conversationId);
            catalogState.pendingConversationIds.add(conversationId);
        }

        processPendingConversationMetadata();
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

    let isRendering = false;

    /**
     * 按当前 DOM 顺序重建分组头。
     * 新版页面已经负责排序，我们只需要根据缓存中的 `update_time` 决定组边界。
     * @param {HTMLElement} historyRoot 历史根节点
     */
    function renderGroupedChats(historyRoot) {
        if (!(historyRoot instanceof HTMLElement) || isRendering) return;

        isRendering = true;

        try {
            clearGroupedChats(historyRoot);

            const container = getRenderableHistoryContainer(historyRoot);
            if (!(container instanceof HTMLElement)) return;

            syncGroupHeaderPadding(historyRoot, container);

            const { conversationIndex, cacheRevision } = loadConversationIndex();
            let lastLabel = null;
            const missingConversationIds = [];

            container.querySelectorAll(CONVERSATION_SELECTOR).forEach(node => {
                const conversationId = getConversationIdFromNode(node);
                const conversation = conversationId ? conversationIndex.get(conversationId) : null;
                const label = getDateGroupLabel(conversation?.update_time || null);

                // 如果当前条目在缓存里还没有时间信息，就直接跳过，不做猜测性分组。
                if (!label) {
                    if (conversationId) missingConversationIds.push(conversationId);
                    return;
                }

                if (label !== lastLabel) {
                    const row = getConversationRow(node);
                    if (row.parentNode) {
                        row.parentNode.insertBefore(createGroupHeader(container, label), row);
                        lastLabel = label;
                    }
                }
            });

            if (missingConversationIds.length > 0) {
                requestMissingConversationMetadata(missingConversationIds, cacheRevision);
            }
        } finally {
            isRendering = false;
        }
    }

    let renderFrameId = null;

    /**
     * 将同一浏览器帧中的刷新请求合并为一次。
     * 已安排的任务不会被后续变化重置，因此持续变化也无法无限推迟渲染。
     */
    function queueRender() {
        if (renderFrameId !== null) return;

        renderFrameId = window.requestAnimationFrame(() => {
            renderFrameId = null;
            const historyRoot = document.querySelector(HISTORY_ROOT_SELECTOR);
            if (historyRoot instanceof HTMLElement) {
                renderGroupedChats(historyRoot);
            }
        });
    }

    /**
     * 判断一次 DOM 变更是否只来自脚本自己的分组头。
     * 这样可以避免插入/删除分组头反过来触发无限重渲染。
     * @param {MutationRecord} mutation DOM 变更记录
     * @returns {boolean} 是否只包含脚本自身的节点
     */
    function isOwnHeaderMutation(mutation) {
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return changedNodes.length > 0 && changedNodes.every(node => (
            node instanceof HTMLElement && node.matches(HEADER_SELECTOR)
        ));
    }

    let activeHistoryObserver = null;

    /**
     * 监听历史列表的节点变化。
     * 新版侧栏展开、搜索、置顶等操作都会触发这里的重渲染。
     * @param {HTMLElement} historyRoot 历史根节点
     */
    function observeChatList(historyRoot) {
        if (activeHistoryObserver) {
            activeHistoryObserver.disconnect();
            activeHistoryObserver = null;
        }

        const observer = new MutationObserver(mutations => {
            if (isRendering || mutations.every(isOwnHeaderMutation)) return;
            queueRender();
        });

        observer.observe(historyRoot, { childList: true, subtree: true });
        activeHistoryObserver = observer;
    }

    /**
     * 监听 localStorage 中的历史缓存更新。
     * 同页内写入不会触发 `storage` 事件，因此额外补一个原型级别的拦截。
     */
    function installHistoryCacheListeners() {
        window.addEventListener('storage', event => {
            if (typeof event.key === 'string' && isConversationHistoryCacheKey(event.key)) {
                queueRender();
            }
        });

        if (Storage.prototype.__chatGroupingPatched) return;

        const originalSetItem = Storage.prototype.setItem;
        const originalRemoveItem = Storage.prototype.removeItem;

        Storage.prototype.setItem = function (key, value) {
            const result = originalSetItem.apply(this, arguments);
            if (this === localStorage && typeof key === 'string' && isConversationHistoryCacheKey(key)) {
                queueRender();
            }
            return result;
        };

        Storage.prototype.removeItem = function (key) {
            const result = originalRemoveItem.apply(this, arguments);
            if (this === localStorage && typeof key === 'string' && isConversationHistoryCacheKey(key)) {
                queueRender();
            }
            return result;
        };

        Storage.prototype.__chatGroupingPatched = true;
    }

    /**
     * 低频检查历史缓存是否变化。
     * 这条链路专门覆盖 Tampermonkey 沙盒无法拦截页面写缓存的情况。
     */
    function startHistoryCachePolling() {
        let lastSignature = buildHistoryCacheSignature();

        function checkHistoryCache() {
            if (document.hidden) return;

            const nextSignature = buildHistoryCacheSignature();
            if (nextSignature === lastSignature) return;

            lastSignature = nextSignature;
            queueRender();
        }

        window.setTimeout(checkHistoryCache, Math.floor(CACHE_POLL_INTERVAL_MS / 2));
        window.setInterval(checkHistoryCache, CACHE_POLL_INTERVAL_MS);
    }

    /**
     * 安排下一次本地日期变化后的刷新。
     * `今天/昨天/几天前` 这些标签不依赖 DOM 变化，跨过午夜后必须主动重算。
     */
    function scheduleMidnightRefresh() {
        const now = new Date();
        const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
        const delay = Math.max(1000, nextDay.getTime() - now.getTime());

        window.setTimeout(() => {
            queueRender();
            scheduleMidnightRefresh();
        }, delay);
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
        startHistoryCachePolling();
        scheduleMidnightRefresh();

        const rootObserver = new MutationObserver(() => {
            const historyRoot = document.querySelector(HISTORY_ROOT_SELECTOR);
            if (historyRoot instanceof HTMLElement) {
                setup(historyRoot);
            }
        });

        rootObserver.observe(document.body, { childList: true, subtree: true });

        // 页面从 bfcache 恢复、标签页重新可见或窗口重新聚焦时，补一次轻量刷新。
        window.addEventListener('pageshow', queueRender);
        window.addEventListener('focus', queueRender);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) queueRender();
        });

        const historyRootNow = document.querySelector(HISTORY_ROOT_SELECTOR);
        if (historyRootNow instanceof HTMLElement) {
            setup(historyRootNow);
        }
    })();
})();
