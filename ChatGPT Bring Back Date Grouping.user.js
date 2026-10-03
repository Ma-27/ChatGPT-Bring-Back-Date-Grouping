// ==UserScript==
// @name        ChatGPT bring back date grouping
// @version     2.5.8
// @author      tiramifue
// @description Brings back the date grouping on chatgpt.com
// @match       https://chatgpt.com/*
// @run-at      document-end
// @namespace   https://greasyfork.org/users/570213
// @license     Apache-2.0
// @grant       none
// @sandbox     raw
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
    const METADATA_POLL_INTERVAL_MS = 1000;

    // Page context is required to read the same committed React data as the sidebar.
    const style = document.createElement('style');
    style.textContent = `
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
    `;
    document.head.append(style);

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
     * Index the committed React conversations belonging to these mounted links.
     * DOM fibers can point to either tree. Collect both ancestor paths, then walk
     * only their committed branches from FiberRoot.current. Shared paths are visited
     * once; unrelated subtrees (including message bodies) are never traversed.
     * @param {Array<HTMLAnchorElement>} nodes Mounted conversation links
     * @returns {Map<string, object>} Conversation metadata indexed by ID
     */
    function loadConversationIndex(nodes) {
        const idsByNode = new Map(nodes.map(node => [node, getConversationIdFromNode(node)]));
        const paths = new Set();
        const roots = new Set();
        const pending = nodes.map(node => {
            const key = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
            return key ? node[key] : null;
        });

        while (pending.length > 0) {
            const fiber = pending.pop();
            if (!fiber || paths.has(fiber)) continue;
            paths.add(fiber);
            if (fiber.return) pending.push(fiber.return);
            else if (fiber.stateNode?.current) roots.add(fiber.stateNode.current);
            if (fiber.alternate) pending.push(fiber.alternate);
        }

        const conversationIndex = new Map();
        const branches = [...roots].map(fiber => ({ fiber, conversation: null }));
        while (branches.length > 0) {
            const branch = branches.pop();
            const { fiber } = branch;
            const conversation = fiber.memoizedProps?.conversation || branch.conversation;
            const id = idsByNode.get(fiber.stateNode);
            if (id && conversation?.id === id) conversationIndex.set(id, conversation);

            // Follow current child/sibling edges, never the possibly stale return chain.
            for (let child = fiber.child; child; child = child.sibling) {
                if (paths.has(child)) branches.push({ fiber: child, conversation });
            }
        }
        return conversationIndex;
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
     * The page owns sorting; committed update_time values determine group boundaries.
     * @param {HTMLElement} historyRoot History section root
     */
    function renderGroupedChats(historyRoot) {
        if (!(historyRoot instanceof HTMLElement) || isRendering) return;

        isRendering = true;

        try {
            const container = getRenderableHistoryContainer(historyRoot);
            if (!(container instanceof HTMLElement)) return;

            const nodes = [...container.querySelectorAll(CONVERSATION_SELECTOR)];
            const conversationIndex = loadConversationIndex(nodes);
            const groups = [];
            let lastLabel = null;

            nodes.forEach(node => {
                const conversationId = getConversationIdFromNode(node);
                const conversation = conversationId ? conversationIndex.get(conversationId) : null;
                const label = getDateGroupLabel(conversation?.update_time || null);

                // An absent timestamp is not evidence of a date; wait for committed metadata.
                if (!label) {
                    // An unknown timestamp breaks the group; the next known entry needs a new header.
                    lastLabel = null;
                    return;
                }

                if (label !== lastLabel) {
                    const row = getConversationRow(node, container);
                    if (row) {
                        groups.push({ row, label });
                        lastLabel = label;
                    }
                }
            });

            // Polling must not rewrite unchanged headers or disturb scroll anchoring.
            const headers = [...historyRoot.querySelectorAll(HEADER_SELECTOR)];
            const unchanged = headers.length === groups.length && groups.every((group, index) => (
                headers[index].textContent === group.label && headers[index].nextElementSibling === group.row
            ));
            if (unchanged) return;

            clearGroupedChats(historyRoot);
            syncGroupHeaderPadding(historyRoot, container);
            for (const { row, label } of groups) {
                container.insertBefore(createGroupHeader(container, label), row);
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
     * A React prop update need not mutate a row's DOM. Check committed metadata
     * while visible, coalescing with DOM signals and leaving unchanged headers intact.
     */
    function startMetadataPolling() {
        window.setInterval(() => {
            if (!document.hidden) queueRender();
        }, METADATA_POLL_INTERVAL_MS);
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

        startMetadataPolling();
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
