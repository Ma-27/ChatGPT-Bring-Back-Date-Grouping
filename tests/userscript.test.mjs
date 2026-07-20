/**
 * 在隔离的浏览器模型中验证 userscript 的刷新调度和元数据请求状态。
 * 测试只模拟脚本实际使用的 DOM API，避免把测试绑定到完整浏览器实现。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const PROJECT_DIR = path.resolve(import.meta.dirname, '..');
const USER_SCRIPT_PATH = path.join(PROJECT_DIR, 'ChatGPT Bring Back Date Grouping.user.js');
const USER_SCRIPT_SOURCE = await fs.readFile(USER_SCRIPT_PATH, 'utf8');
const HISTORY_CACHE_KEY = 'cache/test-user/test-workspace/conversation-history';

/**
 * 构造 ChatGPT conversation-history 的最小有效结构。
 * @param {Array<object>} items 会话条目
 * @param {number} revision 测试使用的缓存版本
 * @returns {string} localStorage 原始值
 */
function createHistoryCache(items, revision) {
  return JSON.stringify({
    value: {
      pages: [
        {
          items,
          total: items.length,
          limit: items.length,
          offset: 0
        }
      ],
      pageParams: [0]
    },
    timestamp: revision,
    version: 1
  });
}

/**
 * 构造具备有效更新时间的会话元数据。
 * @param {string} id 会话 ID
 * @returns {object} 会话元数据
 */
function createConversation(id) {
  return {
    id,
    update_time: '2026-07-20T08:00:00.000Z',
    is_archived: false
  };
}

/**
 * 创建 userscript 所需的最小浏览器运行环境。
 * @param {object} options 环境选项
 * @param {Array<string>} options.visibleConversationIds 初始可见会话 ID
 * @param {Array<object>} options.cachedConversations 初始缓存会话
 * @param {(url: URL) => Promise<object>} options.fetchPage API 页面提供器
 * @returns {Promise<object>} 可控制的测试环境
 */
async function createHarness({
  visibleConversationIds,
  cachedConversations,
  fetchPage = async () => ({ items: [], total: 0 })
}) {
  const animationFrames = [];
  const headers = [];
  const observers = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const warnings = [];
  const fetchOffsets = [];
  let renderCount = 0;

  class FakeStyle {
    setProperty() {}
  }

  class FakeHTMLElement {
    constructor(tagName = 'DIV') {
      this.tagName = tagName;
      this.className = '';
      this.style = new FakeStyle();
      this.parentNode = null;
    }

    matches(selector) {
      return selector === '.__chat-group-header' && this.className === '__chat-group-header';
    }

    getBoundingClientRect() {
      return { left: this.tagName === 'SPAN' ? 24 : 0 };
    }

    setAttribute() {}

    remove() {
      const index = headers.indexOf(this);
      if (index >= 0) headers.splice(index, 1);
    }
  }

  class FakeHTMLAnchorElement extends FakeHTMLElement {
    constructor(conversationId, row) {
      super('A');
      this.conversationId = conversationId;
      this.row = row;
      this.titleElement = new FakeHTMLElement('SPAN');
    }

    getAttribute(name) {
      return name === 'href' ? `/c/${this.conversationId}` : null;
    }

    querySelector() {
      return this.titleElement;
    }

    closest(selector) {
      return selector === 'li' ? this.row : null;
    }
  }

  const container = new FakeHTMLElement('UL');
  container.insertBefore = header => {
    header.parentNode = container;
    headers.push(header);
  };

  const anchors = [];

  function addVisibleConversation(conversationId) {
    const row = new FakeHTMLElement('LI');
    row.parentNode = container;
    anchors.push(new FakeHTMLAnchorElement(conversationId, row));
  }

  visibleConversationIds.forEach(addVisibleConversation);

  const historyRoot = new FakeHTMLElement('DIV');
  historyRoot.querySelector = selector => {
    if (selector === 'ul') return container;
    if (selector.includes('/c/')) return anchors[0] || null;
    return null;
  };
  historyRoot.querySelectorAll = selector => {
    if (selector === '.__chat-group-header') {
      renderCount += 1;
      return [...headers];
    }
    return [];
  };

  container.querySelectorAll = selector => selector.includes('/c/') ? [...anchors] : [];

  class FakeStorage {
    constructor() {
      this.entries = new Map();
    }

    get length() {
      return this.entries.size;
    }

    key(index) {
      return [...this.entries.keys()][index] ?? null;
    }

    getItem(key) {
      return this.entries.get(String(key)) ?? null;
    }

    setItem(key, value) {
      this.entries.set(String(key), String(value));
    }

    removeItem(key) {
      this.entries.delete(String(key));
    }
  }

  const localStorage = new FakeStorage();
  localStorage.setItem(HISTORY_CACHE_KEY, createHistoryCache(cachedConversations, 1));

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.target = null;
      observers.push(this);
    }

    observe(target) {
      this.target = target;
    }

    disconnect() {
      this.target = null;
    }

    trigger(mutations = [{ addedNodes: [new FakeHTMLElement('LI')], removedNodes: [] }]) {
      this.callback(mutations);
    }
  }

  const document = {
    body: new FakeHTMLElement('BODY'),
    hidden: false,
    querySelector: selector => selector === '#history' ? historyRoot : null,
    createElement: tagName => new FakeHTMLElement(String(tagName).toUpperCase()),
    addEventListener: (name, listener) => {
      const listeners = documentListeners.get(name) || [];
      listeners.push(listener);
      documentListeners.set(name, listeners);
    }
  };

  const window = {
    requestAnimationFrame: callback => {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    setTimeout: () => 1,
    setInterval: () => 1,
    addEventListener: (name, listener) => {
      const listeners = windowListeners.get(name) || [];
      listeners.push(listener);
      windowListeners.set(name, listeners);
    }
  };

  const fetch = async urlText => {
    const url = new URL(urlText);
    fetchOffsets.push(Number(url.searchParams.get('offset')));
    const payload = await fetchPage(url);
    return {
      ok: true,
      status: 200,
      json: async () => payload
    };
  };

  const context = vm.createContext({
    URL,
    Date,
    Map,
    Set,
    Promise,
    console: {
      log() {},
      warn(...args) {
        warnings.push(args);
      }
    },
    document,
    window,
    location: { origin: 'https://chatgpt.com' },
    localStorage,
    Storage: FakeStorage,
    HTMLElement: FakeHTMLElement,
    HTMLAnchorElement: FakeHTMLAnchorElement,
    MutationObserver: FakeMutationObserver,
    GM_addStyle() {},
    fetch
  });

  vm.runInContext(USER_SCRIPT_SOURCE, context, { filename: USER_SCRIPT_PATH });

  return {
    addVisibleConversation,
    animationFrames,
    fetchOffsets,
    get renderCount() {
      return renderCount;
    },
    get warnings() {
      return warnings;
    },
    localStorage,
    triggerFocus() {
      for (const listener of windowListeners.get('focus') || []) listener();
    },
    triggerHistoryMutation() {
      const historyObserver = observers.find(observer => observer.target === historyRoot);
      assert.ok(historyObserver, '历史列表 observer 应当已经安装');
      historyObserver.trigger();
    },
    flushAnimationFrame() {
      const callback = animationFrames.shift();
      assert.ok(callback, '应当存在待执行的 animation frame');
      callback();
    },
    async settleAsyncWork() {
      // 多页 fetch 每页包含两个 await，这里让微任务和 finally 链全部完成。
      for (let index = 0; index < 12; index += 1) {
        await new Promise(resolve => setImmediate(resolve));
      }
    },
    updateCacheRevision(revision) {
      localStorage.setItem(HISTORY_CACHE_KEY, createHistoryCache(cachedConversations, revision));
    }
  };
}

test('刷新请求按浏览器帧合并，持续变化不会重置已有任务', async () => {
  const conversation = createConversation('known-conversation');
  const harness = await createHarness({
    visibleConversationIds: [conversation.id],
    cachedConversations: [conversation]
  });

  assert.equal(harness.animationFrames.length, 1, '首次挂载只应安排一帧');

  for (let index = 0; index < 100; index += 1) harness.triggerFocus();
  assert.equal(harness.animationFrames.length, 1, '同一帧中的重复信号必须合并');

  harness.flushAnimationFrame();
  assert.equal(harness.renderCount, 1);

  for (let frame = 0; frame < 5; frame += 1) {
    for (let index = 0; index < 50; index += 1) harness.triggerHistoryMutation();
    assert.equal(harness.animationFrames.length, 1, '持续变化期间每帧最多保留一个任务');
    harness.flushAnimationFrame();
  }

  assert.equal(harness.renderCount, 6, '持续变化期间每一帧都能完成刷新，不会等待静默期');
});

test('同一缓存版本复用 API 分页游标，并在目录耗尽后停止请求', async () => {
  const apiItems = Array.from({ length: 120 }, (_, index) => createConversation(`api-${index}`));
  const harness = await createHarness({
    visibleConversationIds: ['api-10'],
    cachedConversations: [],
    fetchPage: async url => {
      const offset = Number(url.searchParams.get('offset'));
      return {
        items: apiItems.slice(offset, offset + 50),
        total: apiItems.length
      };
    }
  });

  harness.flushAnimationFrame();
  await harness.settleAsyncWork();
  assert.deepEqual(harness.fetchOffsets, [0], '首个目标位于第一页时只读取第一页');

  harness.addVisibleConversation('api-70');
  harness.triggerHistoryMutation();
  harness.flushAnimationFrame();
  await harness.settleAsyncWork();
  assert.deepEqual(harness.fetchOffsets, [0, 50], '新目标应从上次 offset 继续');

  harness.addVisibleConversation('not-in-catalog');
  harness.triggerHistoryMutation();
  harness.flushAnimationFrame();
  await harness.settleAsyncWork();
  assert.deepEqual(harness.fetchOffsets, [0, 50, 100], '不存在的目标只会耗尽剩余目录一次');

  harness.addVisibleConversation('another-missing-id');
  for (let index = 0; index < 10; index += 1) harness.triggerFocus();
  harness.flushAnimationFrame();
  await harness.settleAsyncWork();
  assert.deepEqual(harness.fetchOffsets, [0, 50, 100], '目录已耗尽时不得重新扫描');

  harness.updateCacheRevision(2);
  harness.flushAnimationFrame();
  await harness.settleAsyncWork();
  assert.deepEqual(
    harness.fetchOffsets,
    [0, 50, 100, 0, 50, 100],
    '历史缓存版本变化后才允许重新建立目录状态'
  );
});

test('失败请求在相同缓存版本中不会被重复信号无限重试', async () => {
  let requestCount = 0;
  const harness = await createHarness({
    visibleConversationIds: ['missing-conversation'],
    cachedConversations: [],
    fetchPage: async () => {
      requestCount += 1;
      throw new Error('测试网络失败');
    }
  });

  harness.flushAnimationFrame();
  await harness.settleAsyncWork();
  assert.equal(requestCount, 1);
  assert.equal(harness.warnings.length, 1);

  for (let index = 0; index < 20; index += 1) harness.triggerFocus();
  harness.flushAnimationFrame();
  await harness.settleAsyncWork();
  assert.equal(requestCount, 1, '相同输入版本不得反复重试失败请求');

  harness.updateCacheRevision(2);
  harness.flushAnimationFrame();
  await harness.settleAsyncWork();
  assert.equal(requestCount, 2, '输入版本变化后可以执行新的确定性请求');
});
