/**
 * 基于 2026-09-30 实际侧栏的语义属性和父子层级验证分组。
 * 使用独立 DOM 和虚构会话，不读取浏览器账号或访问网络。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const source = await fs.readFile(new URL('../ChatGPT Bring Back Date Grouping.user.js', import.meta.url), 'utf8');
const cacheKey = 'cache/test-user/test-workspace/conversation-history';

test('Installable userscript remains ASCII-only for text import across devices', () => {
  assert.match(source, /^[\x00-\x7f]*$/);
});

/** 复现拖拽行、动画容器、标题链接和操作按钮的真实层级。 */
function conversationRow(id) {
  return `<div role="listitem" data-sidebar-chatgpt-conversation-key="chatgpt:conversation:${id}">
    <div class="overflow-hidden"><div role="group" class="sidebar-item">
      <div><div><div data-thread-title-trigger="true">
        <a href="/c/${id}" data-interactive-row-link="true"><span data-thread-title="true">${id}</span></a>
      </div></div></div><div><button>聊天操作</button><button>置顶聊天</button></div>
    </div></div>
  </div>`;
}

/** 各个区域共用行结构，只有 Recents 应当插入日期标题。 */
function section(name, ids) {
  return `<section data-app-action-sidebar-section-heading="${name}">
    <div><div>区域标题</div><div aria-hidden="false"><div class="overflow-hidden">
      <div data-appearance="plain"><div role="list">${ids.map(conversationRow).join('')}</div></div>
    </div></div></div>
  </section>`;
}

/** 使用本地日历时间构造数据，使断言不依赖执行测试的日期和时区。 */
function conversation(id, daysAgo = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return { id, update_time: date.toISOString() };
}

/** 提供真实 MutationObserver、可控帧调度和隔离的元数据响应。 */
function createPage(t, html, items) {
  const dom = new JSDOM(html, { url: 'https://chatgpt.com/', runScripts: 'outside-only' });
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
  window.GM_addStyle = () => {};
  window.console.log = () => {};
  window.console.warn = (...args) => warnings.push(args);
  window.fetch = async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ items: [], total: 0 }) };
  };
  function updateCache(nextItems) {
    window.localStorage.setItem(cacheKey, JSON.stringify({ value: { pages: [{ items: nextItems }] } }));
  }
  updateCache(items);
  window.eval(source);
  return {
    document: window.document,
    window,
    requests,
    updateCache,
    // 刷新至稳定状态；脚本自身的 DOM 变化若形成循环，测试会明确失败。
    async settle() {
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
function labels(root) {
  return [...root.querySelectorAll('.__chat-group-header')].map(header => {
    assert.ok(header.parentElement.matches('[role="list"], ul, ol'));
    return header.textContent;
  });
}

test('新版 Recents：整行分组，不改动置顶、项目、聊天正文或原有行', async t => {
  const html = section('Pinned', ['pinned']) + section('Projects', ['project'])
    + section('Recents', ['today-a', 'today-b', 'yesterday']) + '<main><a href="/c/body">正文链接</a></main>';
  const page = createPage(t, html, [conversation('today-a'), conversation('today-b'), conversation('yesterday', 1)]);
  const recents = page.document.querySelector('[data-app-action-sidebar-section-heading="Recents"]');
  const rows = [...recents.querySelectorAll('[role="listitem"]')];
  const originalRows = rows.map(row => row.outerHTML);
  await page.settle();
  assert.deepEqual(labels(recents), ['今天', '昨天']);
  assert.equal(page.document.querySelectorAll('.__chat-group-header').length, 2);
  assert.deepEqual(rows.map(row => row.outerHTML), originalRows, '保留原生链接、拖拽属性和操作按钮');
  assert.deepEqual([...recents.querySelector('[role="list"]').children].filter(node => node.matches('[role="listitem"]')), rows);
  assert.equal(page.requests.length, 0, '元数据完整时不应新增请求');
});

test('新增、删除、重排和 href 复用都重新计算日期边界', async t => {
  const items = [conversation('today'), conversation('yesterday', 1), conversation('older', 8)];
  const page = createPage(t, section('Recents', ['today', 'yesterday']), items);
  const list = page.document.querySelector('[role="list"]');
  await page.settle();
  list.insertAdjacentHTML('beforeend', conversationRow('older'));
  await page.settle();
  assert.deepEqual(labels(list), ['今天', '昨天', '上周']);
  const today = list.querySelector('[role="listitem"]');
  list.append(today);
  await page.settle();
  assert.deepEqual(labels(list), ['昨天', '上周', '今天']);
  today.querySelector('a').setAttribute('href', '/c/older');
  await page.settle();
  assert.deepEqual(labels(list), ['昨天', '上周']);
  list.querySelector('[role="listitem"]').remove();
  await page.settle();
  assert.deepEqual(labels(list), ['上周']);
});

test('侧栏延迟挂载、多实例、卸载重建及同一节点重新挂载', async t => {
  const page = createPage(t, '<main></main>', [conversation('today')]);
  await page.settle();
  page.document.body.insertAdjacentHTML('beforeend', section('Recents', ['today']) + section('Recents', ['today']));
  await page.settle();
  const [desktop, popover] = page.document.querySelectorAll('section');
  assert.deepEqual(labels(desktop), ['今天']);
  assert.deepEqual(labels(popover), ['今天']);
  desktop.remove();
  await page.settle();
  desktop.querySelector('[role="list"]').replaceChildren();
  page.document.body.append(desktop);
  await page.settle();
  assert.deepEqual(labels(desktop), []);
  desktop.querySelector('[role="list"]').insertAdjacentHTML('beforeend', conversationRow('today'));
  await page.settle();
  assert.deepEqual(labels(desktop), ['今天']);
  popover.outerHTML = section('Recents', ['today']);
  await page.settle();
  assert.equal(page.document.querySelectorAll('.__chat-group-header').length, 2);
});

test('未知元数据不猜日期，缓存补齐后自动更新且不重复插入', async t => {
  const page = createPage(t, section('Recents', ['today', 'missing', 'today-again']), [conversation('today'), conversation('today-again')]);
  await page.settle();
  assert.deepEqual(labels(page.document), ['今天', '今天']);
  assert.equal(page.requests.length, 1);
  page.updateCache([conversation('today'), conversation('missing', 1), conversation('today-again')]);
  await page.settle();
  assert.deepEqual(labels(page.document), ['今天', '昨天', '今天']);
  for (let i = 0; i < 20; i += 1) page.window.dispatchEvent(new page.window.Event('focus'));
  await page.settle();
  assert.deepEqual(labels(page.document), ['今天', '昨天', '今天']);
});

test('原有 #history 列表仍使用 li 标题', async t => {
  const page = createPage(t, '<div id="history"><ul><li><a href="/c/today">today</a></li></ul></div>', [conversation('today')]);
  await page.settle();
  assert.deepEqual(labels(page.document), ['今天']);
  assert.equal(page.document.querySelector('.__chat-group-header').tagName, 'LI');
});

test('Older rows added to Recents render month and year groups beyond two months', async t => {
  const now = new Date();
  // The first day of each month keeps these fixtures outside the day/week groups.
  const months = [2, 3, 4, 5, 6, 7, 12, 24];
  const items = months.map(month => ({
    id: `month-${month}`,
    update_time: new Date(now.getFullYear(), now.getMonth() - month, 1, 12).toISOString()
  }));
  const page = createPage(t, section('Recents', [items[0].id]), items);
  await page.settle();
  assert.deepEqual(labels(page.document), ['2个月前']);

  // Reproduce additional history rows mounting as the user scrolls the sidebar.
  const list = page.document.querySelector('[role="list"]');
  list.insertAdjacentHTML('beforeend', items.slice(1).map(item => conversationRow(item.id)).join(''));
  await page.settle();
  assert.deepEqual(labels(list), ['2个月前', '3个月前', '4个月前', '5个月前', '6个月前', '半年前', '1年前', '2年前']);
  assert.equal(page.requests.length, 0, 'Cached timestamps should be sufficient for every date group');
});

test('Project conversation links in Recents retain month/year groups and survive URL changes', async t => {
  const now = new Date();
  const items = [2, 6, 12, 24].map(month => ({
    id: `month-${month}`,
    update_time: new Date(now.getFullYear(), now.getMonth() - month, 1, 12).toISOString()
  }));
  const html = section('Recents', items.map(item => item.id))
    .replace('href="/c/month-6"', 'href="/g/g-p-example/c/month-6"')
    .replace('href="/c/month-12"', 'href="https://chatgpt.com/g/g-p-example/c/month-12?view=chat#latest"')
    .replace('href="/c/month-24"', 'href="/g/g-example/c/month-24"');
  const page = createPage(t, html + section('Projects', ['month-12']), items);
  await page.settle();
  assert.deepEqual(labels(page.document), ['2个月前', '6个月前', '1年前', '2年前']);
  const links = page.document.querySelectorAll('section:first-child a');
  links[1].setAttribute('href', '/c/month-6');
  links[0].setAttribute('href', '/g/g-p-example/c/month-2');
  await page.settle();
  assert.deepEqual(labels(page.document), ['2个月前', '6个月前', '1年前', '2年前']);
  assert.equal(page.requests.length, 0, 'Project URLs must resolve to the same cached conversation IDs');
});
