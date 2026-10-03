/**
 * 基于 2026-09-30 实际侧栏的语义属性和父子层级验证分组。
 * 使用独立 DOM 和虚构会话，不读取浏览器账号或访问网络。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { conversationRow, section, conversation, createPage, labels } from './helpers/sidebar-page.mjs';

const source = await fs.readFile(new URL('../ChatGPT Bring Back Date Grouping.user.js', import.meta.url), 'utf8');

test('Installable userscript remains ASCII-only and requires page context', () => {
  assert.match(source, /^[\x00-\x7f]*$/);
  assert.match(source, /@grant\s+none/);
  assert.match(source, /@sandbox\s+raw/);
});

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

test('未知元数据不猜日期，React 提交后自动更新且不重复插入', async t => {
  const page = createPage(t, section('Recents', ['today', 'missing', 'today-again']), [conversation('today'), conversation('today-again')]);
  await page.settle();
  assert.deepEqual(labels(page.document), ['今天', '今天']);
  assert.equal(page.requests.length, 0);
  page.commit([conversation('today'), conversation('missing', 1), conversation('today-again')]);
  page.poll();
  await page.settle();
  assert.deepEqual(labels(page.document), ['今天', '昨天', '今天']);
  for (let i = 0; i < 20; i += 1) page.window.dispatchEvent(new page.window.Event('focus'));
  page.poll();
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
  assert.equal(page.requests.length, 0, 'Committed timestamps should cover every date group');
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
  assert.equal(page.requests.length, 0, 'Project URLs must resolve to the same committed conversation IDs');
});
