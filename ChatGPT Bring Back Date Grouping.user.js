// ==UserScript==
// @name        ChatGPT bring back date grouping
// @version     2.5.7
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

// updated 2026-10-03

(function () {
    'use strict';

    // The 2026-09 sidebar has a separate Recents section; use semantic attributes, not localized text or CSS classes.
    const HISTORY_ROOT_SELECTOR = '#history, [data-app-action-sidebar-section-heading="Recents"]';
    const CONVERSATION_SELECTOR = 'a[href*="/c/"]';
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
     * Map an ISO timestamp to a Chinese date-group label.
     * Group by the most recent update time, preserving the existing semantics.
     * @param {string} isoString ISO timestamp
     * @returns {string|null} Group label
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

        if (daysAgo <= 0) return '\u4eca\u5929';
        if (daysAgo === 1) return '\u6628\u5929';
        if (daysAgo <= 6) return `${daysAgo}\u5929\u524d`;
        if (daysAgo <= 13) return '\u4e0a\u5468';
        if (daysAgo <= 20) return '2\u5468\u524d';
        if (daysAgo <= 31) return '\u4e0a\u4e2a\u6708';
        if (monthsAgo <= 6) return `${monthsAgo}\u4e2a\u6708\u524d`;
        if (monthsAgo <= 11) return '\u534a\u5e74\u524d';
        const yearsAgo = Math.floor(monthsAgo / 12);
        return `${yearsAgo}\u5e74\u524d`;
    }

    /**
     * Extract IDs from /c/:id and /g/:projectOrGpt/c/:id on ChatGPT.
     * Both relative links and absolute same-site links can appear in Recents.
     * @param {HTMLAnchorElement} node Conversation link
     * @returns {string|null} Conversation ID
     */
    function getConversationIdFromNode(node) {
        if (!(node instanceof HTMLAnchorElement)) return null;

        const href = node.getAttribute('href') || '';
        const match = href.match(/^(?:https:\/\/chatgpt\.com)?\/(?:g\/[^/?#]+\/)?c\/([^/?#]+)\/?(?:[?#]|$)/);
        return match ? match[1] : null;
    }

    /**
     * Identify ChatGPT conversation-history keys in localStorage.
     * Keys may have a user/workspace prefix, so match the final path segment as well.
     * @param {string} storageKey Storage key
     * @returns {boolean} Whether the key contains conversation history
     */
    function isConversationHistoryCacheKey(storageKey) {
        return storageKey === HISTORY_CACHE_NAME || storageKey.endsWith(`/${HISTORY_CACHE_NAME}`);
    }

    /**
     * Compute a lightweight stable hash to detect changes in cached content.
     * @param {string} value Raw string
     * @returns {string} Base-36 hash
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
     * Build a content signature for all conversation-history caches.
     * The Tampermonkey sandbox may not intercept page-context setItem calls;
     * polling the signature detects those updates.
     * @returns {string} Current history-cache signature
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
     * Extract pages from a TanStack Query-style paginated cache.
     * Accept only the explicit pages/items structure to exclude unrelated caches.
     * @param {object} payload Parsed cache entry
     * @returns {Array<object>} Cached pages
     */
    function getHistoryPages(payload) {
        if (Array.isArray(payload?.value?.pages)) return payload.value.pages;
        if (Array.isArray(payload?.pages)) return payload.pages;
        return [];
    }

    /**
     * Extract conversations from a paginated or flat cache.
     * @param {object} payload Parsed cache entry
     * @returns {Array<object>} Conversation entries
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
     * Insert a conversation into the index.
     * For duplicate IDs, keep the entry with the most recent update time.
     * @param {Map<string, object>} conversationIndex Conversation index
     * @param {object} item Conversation entry
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
     * Parse a single localStorage entry.
     * ChatGPT stores paginated history under the conversation-history key.
     * @param {string|null} rawValue Raw cached string
     * @returns {Array<object>} Conversation entries
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
     * Index visible workspace/account history caches by conversation ID.
     * For conversations in multiple caches, keep the most recent update.
     * @returns {{conversationIndex: Map<string, object>, cacheRevision: string}} Index and cache revision
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
     * Create API catalog scan state for a specific history-cache revision.
     * Read pages and attempted IDs belong to this revision; a cache change resets the state.
     * @param {string} cacheRevision History-cache revision
     * @returns {object} API catalog scan state
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
     * Get the API catalog scan state for the current cache revision.
     * @param {string} cacheRevision History-cache revision
     * @returns {object} API catalog scan state
     */
    function getApiCatalogState(cacheRevision) {
        if (!activeApiCatalogState || activeApiCatalogState.cacheRevision !== cacheRevision) {
            activeApiCatalogState = createApiCatalogState(cacheRevision);
        }
        return activeApiCatalogState;
    }

    /**
     * Fetch missing metadata for visible conversations from the history API.
     * Within a cache revision, resume at the last successful offset without rescanning pages.
     * @param {Set<string>} targetIds Visible conversation IDs missing timestamps
     * @param {object} catalogState API catalog scan state for this cache revision
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

            // Advance only after parsing the current page; a network failure must not skip unread entries.
            catalogState.nextOffset = offset + items.length;
            catalogState.exhausted = items.length === 0 || catalogState.nextOffset >= catalogState.total;
        }

        if (hasNewMetadata) queueRender();
    }

    /**
     * Process pending conversation IDs for the current cache revision in sequence.
     * Deduplicate requests in a set and process newly queued IDs after the current fetch.
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
     * Request missing conversation metadata from the API.
     * Each missing ID enters the scan at most once per cache revision.
     * @param {Array<string>} missingConversationIds Visible IDs missing timestamps
     * @param {string} cacheRevision History-cache revision
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
     * Find the container that directly holds conversation rows.
     * Recents uses role=list; the earlier #history layout uses ul. Do not select the whole sidebar.
     * @param {HTMLElement} historyRoot History section root
     * @returns {HTMLElement|null} Container for group headers
     */
    function getRenderableHistoryContainer(historyRoot) {
        if (!(historyRoot instanceof HTMLElement)) return null;
        return historyRoot.querySelector('[role="list"], ul, ol');
    }

    /**
     * Find the complete row before which a group header should be inserted.
     * Links are nested inside title, action, and animation wrappers; use a direct list child.
     * @param {Element} node Conversation link
     * @param {HTMLElement} container History list container
     * @returns {Element|null} Row to use as the insertion anchor
     */
    function getConversationRow(node, container) {
        let row = node;
        while (row && row.parentElement !== container) {
            row = row.parentElement;
        }
        return row;
    }

    /**
     * Remove headers from the previous render to avoid duplicates.
     * @param {HTMLElement} historyRoot History section root
     */
    function clearGroupedChats(historyRoot) {
        historyRoot.querySelectorAll(HEADER_SELECTOR).forEach(element => element.remove());
    }

    /**
     * Align group headers with the first conversation title's indentation.
     * @param {HTMLElement} historyRoot History section root
     * @param {HTMLElement} container Container receiving group headers
     */
    function syncGroupHeaderPadding(historyRoot, container) {
        const firstAnchor = historyRoot.querySelector(CONVERSATION_SELECTOR);
        if (!(firstAnchor instanceof HTMLElement)) return;

        const titleElement = firstAnchor.querySelector('[data-thread-title], span[dir="auto"], .truncate, span') || firstAnchor;
        if (!(titleElement instanceof HTMLElement)) return;

        const titleRect = titleElement.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const paddingLeft = Math.max(10, Math.round(titleRect.left - containerRect.left));
        container.style.setProperty('--__chat-group-padding-left', `${paddingLeft}px`);
    }

    /**
     * Create a group header.
     * Use li for native lists and div for role=list containers.
     * @param {HTMLElement} container Group-header container
     * @param {string} label Group label
     * @returns {HTMLElement} Group header
     */
    function createGroupHeader(container, label) {
        const tagName = ['UL', 'OL'].includes(container.tagName) ? 'li' : 'div';
        const header = document.createElement(tagName);
        header.className = '__chat-group-header';
        header.textContent = label;
        header.setAttribute('role', 'presentation');
        return header;
    }

    let isRendering = false;

    /**
     * Rebuild group headers in the current DOM order.
     * The page owns sorting; cached update_time values determine group boundaries.
     * @param {HTMLElement} historyRoot History section root
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

                // Skip entries without a cached timestamp instead of guessing their date group.
                if (!label) {
                    if (conversationId) missingConversationIds.push(conversationId);
                    // An unknown timestamp breaks the group; the next known entry needs a new header.
                    lastLabel = null;
                    return;
                }

                if (label !== lastLabel) {
                    const row = getConversationRow(node, container);
                    if (row) {
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
     * Coalesce refresh requests into one render per browser frame.
     * Later requests do not reset the scheduled frame, so ongoing changes cannot starve rendering.
     */
    function queueRender() {
        if (renderFrameId !== null) return;

        renderFrameId = window.requestAnimationFrame(() => {
            renderFrameId = null;
            // Desktop and narrow-screen sidebars can coexist; render each history section separately.
            document.querySelectorAll(HISTORY_ROOT_SELECTOR).forEach(historyRoot => {
                renderGroupedChats(historyRoot);
            });
        });
    }

    /**
     * Check whether a mutation contains only this script's group headers.
     * Ignore those changes to prevent header insertion/removal from causing a render loop.
     * @param {MutationRecord} mutation DOM mutation record
     * @returns {boolean} Whether all changed nodes are script-owned headers
     */
    function isOwnHeaderMutation(mutation) {
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return changedNodes.length > 0 && changedNodes.every(node => (
            node instanceof HTMLElement && node.matches(HEADER_SELECTOR)
        ));
    }

    /**
     * Observe history-list changes caused by sidebar, search, and pin actions.
     * @param {HTMLElement} historyRoot History section root
     * @returns {MutationObserver} Observer managed by the sidebar lifecycle
     */
    function observeChatList(historyRoot) {
        const observer = new MutationObserver(mutations => {
            if (isRendering || mutations.every(isOwnHeaderMutation)) return;
            queueRender();
        });

        observer.observe(historyRoot, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['href']
        });
        return observer;
    }

    /**
     * Listen for conversation-history updates in localStorage.
     * Same-page writes do not emit storage events, so also intercept Storage prototype methods.
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
     * Poll for history-cache changes at a low frequency.
     * This covers page writes that the Tampermonkey sandbox cannot intercept.
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
     * Schedule a refresh after the next local date change.
     * Relative date labels must advance at midnight even when the DOM does not change.
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
     * Watch for history sections throughout the sidebar lifecycle.
     * Collapsing and reopening may replace sections; release observers for unmounted roots.
     */
    (function watchSidebar() {
        const historyObservers = new Map();

        function setup() {
            const historyRoots = new Set(document.querySelectorAll(HISTORY_ROOT_SELECTOR));
            for (const [historyRoot, observer] of historyObservers) {
                if (historyRoots.has(historyRoot)) continue;
                observer.disconnect();
                historyObservers.delete(historyRoot);
            }
            for (const historyRoot of historyRoots) {
                if (historyObservers.has(historyRoot)) continue;
                historyObservers.set(historyRoot, observeChatList(historyRoot));
                queueRender();
                console.log('ChatGPT grouping: sidebar attached.');
            }
        }

        installHistoryCacheListeners();
        startHistoryCachePolling();
        scheduleMidnightRefresh();

        const rootObserver = new MutationObserver(mutations => {
            if (!mutations.every(isOwnHeaderMutation)) setup();
        });

        rootObserver.observe(document.body, { childList: true, subtree: true });

        // Refresh when the page returns from bfcache, becomes visible, or regains focus.
        window.addEventListener('pageshow', queueRender);
        window.addEventListener('focus', queueRender);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) queueRender();
        });

        setup();
    })();
})();
