import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const source = await fs.readFile(new URL('../../ChatGPT Bring Back Date Grouping.user.js', import.meta.url), 'utf8');

/** 复现拖拽行、动画容器、标题链接和操作按钮的真实层级。 */
export function conversationRow(id) {
  return `<div role="listitem" data-sidebar-chatgpt-conversation-key="chatgpt:conversation:${id}">
    <div class="overflow-hidden"><div role="group" class="sidebar-item">
      <div><div><div data-thread-title-trigger="true">
        <a href="/c/${id}" data-interactive-row-link="true"><span data-thread-title="true">${id}</span></a>
      </div></div></div><div><button>聊天操作</button><button>置顶聊天</button></div>
    </div></div>
  </div>`;
}

/** 各个区域共用行结构，只有 Recents 应当插入日期标题。 */
export function section(name, ids) {
  return `<section data-app-action-sidebar-section-heading="${name}">
    <div><div>区域标题</div><div aria-hidden="false"><div class="overflow-hidden">
      <div data-appearance="plain"><div role="list">${ids.map(conversationRow).join('')}</div></div>
    </div></div></div>
  </section>`;
}

/** 使用本地日历时间构造数据，使断言不依赖执行测试的日期和时区。 */
export function conversation(id, daysAgo = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return { id, update_time: date.toISOString() };
}

/** 提供真实 MutationObserver、可控帧调度和隔离的元数据响应。 */
export function createPage(t, html, items) {
  const dom = new JSDOM(html, { url: 'https://chatgpt.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const observers = [];
  // JSDOM close 会移除 document；先断开监听，避免测试清理触发页面回调。
  const NativeMutationObserver = window.MutationObserver;
  window.MutationObserver = class extends NativeMutationObserver {
    constructor(callback) {
      super(callback);
      observers.push(this);
    }
  };
  t.after(() => {
    observers.forEach(observer => observer.disconnect());
    window.close();
  });
  const frames = [];
  const requests = [];
  const warnings = [];
  window.addEventListener('error', event => warnings.push(event.error));
  window.requestAnimationFrame = callback => frames.push(callback);
  window.console.log = () => {};
  window.console.warn = (...args) => warnings.push(args);
  window.fetch = async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ items: [], total: 0 }) };
  };
  let metadata = items;
  // 模拟一次完整 React commit，独立于缓存；新增行仅在提交后才有权威元数据。
  function commit(nextItems = metadata) {
    metadata = nextItems;
    const root = { return: null, child: null, stateNode: {} };
    root.stateNode.current = root;
    let previous = null;
    for (const node of window.document.querySelectorAll('a[href*="/c/"]')) {
      const id = node.getAttribute('href').match(/\/c\/([^/?#]+)/)?.[1];
      const owner = { return: root, child: null, sibling: null,
        memoizedProps: { conversation: metadata.find(item => item.id === id) } };
      const host = { return: owner, stateNode: node, child: null, sibling: null };
      owner.child = host;
      node.__reactFiber$test = host;
      if (previous) previous.sibling = owner;
      else root.child = owner;
      previous = owner;
    }
    return root;
  }
  commit();
  const intervals = [];
  window.setInterval = callback => intervals.push(callback);
  window.eval(source);
  return {
    document: window.document,
    window,
    requests,
    commit,
    poll() { intervals.forEach(callback => callback()); },
    get frames() { return frames; },
    // 刷新至稳定状态；脚本自身的 DOM 变化若形成循环，测试会明确失败。
    async settle({ commitRows = true } = {}) {
      if (commitRows) commit();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise(resolve => setImmediate(resolve));
        if (!frames.length) {
          assert.equal(warnings.length, 0, '执行过程中不应产生脚本错误');
          return;
        }
        frames.splice(0).forEach(callback => callback());
      }
      assert.fail('分组渲染没有收敛，可能存在 MutationObserver 自触发循环');
    }
  };
}

/** 同时检查标题顺序及其父节点，防止标题被错误地插入链接或按钮容器。 */
export function labels(root) {
  return [...root.querySelectorAll('.__chat-group-header')].map(header => {
    assert.ok(header.parentElement.matches('[role="list"], ul, ol'));
    return header.textContent;
  });
}

