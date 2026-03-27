// ==UserScript==
// @name        ChatGPT bring back date grouping
// @version     2.5.2
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

// updated 2026-02-10

(function () {
    'use strict';

    const groupBy = 'updated';

    GM_addStyle(`
.__chat-group-header {
    font-weight: normal;
    padding: 3px 10px;
    padding-left: var(--__chat-group-padding-left, 10px);
    font-size: 0.72rem;
    color: #999;
    margin-top: 0;
}

.__chat-date-label {
    position: absolute;
    top: 0;
    right: 12px;
    font-size: 0.7rem;
    color: #888;
    pointer-events: none;
    background-color: transparent;
    line-height: 1;
    text-shadow: 0 0 2px rgba(0,0,0,0.5);
}

.__chat-timestamp {
    position: absolute;
    right: 8px;
    top: -1px;
    font-size: 0.7rem;
    color: #999;
    pointer-events: none;
}
.__hide-timestamps .__chat-timestamp {
    display: none;
}

.__timestamp-icon {
    position: relative;
    display: inline-block;
    opacity: 1;
    transition: opacity 0.2s;
}

.__timestamp-icon.__disabled {
    opacity: 0.5;
}

.__timestamp-icon.__disabled::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 110%;
    height: 0;
    border-top: 2px solid #fff;
    transform: translate(-50%, -50%) rotate(-45deg);
    transform-origin: center;
    pointer-events: none;
}
    `)

    function getDateGroupLabel(isoString) {
        const date = new Date(isoString);
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

    function getReactFiber(dom) {
        for (const key in dom) {
            if (key.startsWith('__reactFiber$')) return dom[key];
        }
        return null;
    }

    function extractChatInfo(fiber) {
        const c = fiber.memoizedProps?.conversation;
        return c
            ? {
            id: c.id,
            title: c.title,
            created: c.create_time,
            updated: c.update_time,
            node: fiber.stateNode
        }
        : null;
    }

    const seenIds = new Set();
    const chatList = [];

    function processNewChatNode(node) {
        const fiber = getReactFiber(node);
        if (!fiber) return;

        let current = fiber;
        while (current && !current.memoizedProps?.conversation) {
            current = current.return;
        }

        if (!current || !current.memoizedProps?.conversation) return;

        const chat = extractChatInfo(current);
        if (chat && !seenIds.has(chat.id)) {
            seenIds.add(chat.id);
            const dateKey = chat[groupBy];
            chat.node = node;
            chatList.push(chat);

            queueRender();
        }
    }

    function groupChatsByGroupName() {
        const groups = new Map();

        for (const chat of chatList) {
            chat.group = getDateGroupLabel(chat[groupBy]);
            if (!groups.has(chat.group)) groups.set(chat.group, []);
            groups.get(chat.group).push(chat);
        }

        return [...groups.entries()].sort((a, b) => {
            const aTime = new Date(a[1][0][groupBy]).getTime();
            const bTime = new Date(b[1][0][groupBy]).getTime();
            return bTime - aTime;
        });
    }

    function clearGroupedChats(chats) {
        chats.querySelectorAll('.__chat-group-header').forEach(el => el.remove());
    }

    function refreshChatList(chats) {
        seenIds.clear();
        chatList.length = 0;

        chats.querySelectorAll('a[href^="/c/"]').forEach(node => {
            const fiber = getReactFiber(node);
            if (!fiber) return;

            let current = fiber;
            while (current && !current.memoizedProps?.conversation) {
                current = current.return;
            }

            if (!current || !current.memoizedProps?.conversation) return;

            const chat = extractChatInfo(current);
            if (!chat || seenIds.has(chat.id)) return;

            chat.node = node;
            seenIds.add(chat.id);
            chatList.push(chat);
        });
    }

    function renderGroupedChats(chats) {
        const observer = chats.__chatObserver;
        if (observer) observer.disconnect();

        clearGroupedChats(chats);
        refreshChatList(chats);
        const chatByNode = new Map(chatList.map(chat => [chat.node, chat]));
        let lastLabel = null;

        chats.querySelectorAll('a[href^="/c/"]').forEach(node => {
            const chat = chatByNode.get(node);
            if (!chat) return;

            const existingLabel = node.querySelector('.__chat-timestamp');
            if (existingLabel) existingLabel.remove();

            const label = getDateGroupLabel(chat[groupBy]);
            if (label !== lastLabel) {
                const header = document.createElement('div');
                header.className = '__chat-group-header';
                header.textContent = label;
                chats.insertBefore(header, node);
                lastLabel = label;
            }
        });

        if (observer) observer.observe(chats, { childList: true, subtree: true });
    }


    function sortChats(a, b) {
        return new Date(b[groupBy]) - new Date(a[groupBy]);
    }

    let renderTimer = null;

    function queueRender() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            const chats = document.querySelector('#history');
            if (chats) renderGroupedChats(chats);
        }, 200);
    }

    function observeChatList(chats) {
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && node.matches('a[href^="/c/"]')) {
                        processNewChatNode(node);
                        queueRender();
                    }
                }
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === 1 && node.matches('a[href^="/c/"]')) {
                        const index = chatList.findIndex(c => c.node === node);
                        if (index !== -1) {
                            const removed = chatList.splice(index, 1)[0];
                            seenIds.delete(removed.id);
                        }
                        queueRender();
                    }
                }
            }
        });

        observer.observe(chats, { childList: true, subtree: true });
        chats.__chatObserver = observer;
        chats.querySelectorAll('a[href^="/c/"]').forEach(processNewChatNode);
    }

    function syncGroupHeaderPadding(chats) {
        const header = chats?.parentNode?.firstElementChild;
        if (!header) return;

        const titleEl = header.querySelector('h2, h3, [role="heading"]') || header.firstElementChild || header;
        if (!titleEl) return;

        const titleRect = titleEl.getBoundingClientRect();
        const chatsRect = chats.getBoundingClientRect();
        const paddingLeft = Math.max(0, Math.round(titleRect.left - chatsRect.left));
        if (Number.isFinite(paddingLeft)) {
            chats.style.setProperty('--__chat-group-padding-left', `${paddingLeft}px`);
        }
    }

    (function watchSidebar() {
        let lastChats = null;

        function setup(chats) {
            if (!chats || chats === lastChats) return;
            lastChats = chats;


            observeChatList(chats);
            renderGroupedChats(chats);
            syncGroupHeaderPadding(chats);
            console.log("ChatGPT grouping: sidebar attached.");
        }

        const rootObserver = new MutationObserver(() => {
            const chats = document.querySelector('#history');
            if (!chats) return;

            if (chats && chats !== lastChats) {
                setup(chats);
            }
        });

        rootObserver.observe(document.body, { childList: true, subtree: true });

        const chatsNow = document.querySelector('#history');
        if (chatsNow) setup(chatsNow);
    })();


})();
