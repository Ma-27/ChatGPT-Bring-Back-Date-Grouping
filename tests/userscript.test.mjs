/** 验证真实数据缺口、React 双树提交和刷新调度，不依赖缓存替代真实元数据。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPage, conversation, conversationRow, section, labels } from './helpers/sidebar-page.mjs';

test('复现 2.5.7：缓存仅有两个月，滚动新增一年前和两年前仍能分组且无额外请求', async t => {
  const now = new Date();
  const items = [2, 12, 24].map(month => ({id: `m${month}`,
    update_time: new Date(now.getFullYear(), now.getMonth() - month, 1, 12).toISOString()}));
  const page = createPage(t, section('Recents', ['m2']), items);
  page.window.localStorage.setItem('conversation-history', JSON.stringify({value:{items:items.slice(0,1)}}));
  await page.settle();
  page.document.querySelector('[role="list"]').insertAdjacentHTML('beforeend', conversationRow('m12') + conversationRow('m24'));
  await page.settle();
  assert.deepEqual(labels(page.document), ['2个月前', '1年前', '2年前']);
  assert.deepEqual(page.requests, []);
});

test('按帧合并刷新，元数据未改变时复用标题节点，避免滚动跳动', async t => {
  const page = createPage(t, section('Recents', ['a']), [conversation('a')]);
  for (let i = 0; i < 100; i++) page.window.dispatchEvent(new page.window.Event('focus'));
  assert.equal(page.frames.length, 1);
  await page.settle();
  const header = page.document.querySelector('.__chat-group-header');
  for (let i = 0; i < 5; i++) {
    page.poll();
    await page.settle();
    assert.equal(page.document.querySelector('.__chat-group-header'), header);
  }
  page.commit([conversation('a', 1)]);
  page.poll();
  await page.settle({commitRows:false});
  assert.deepEqual(labels(page.document), ['昨天'], '无 DOM 变化的 prop 更新也必须生效');
});

/** 保留 DOM 上的旧 fiber 指针，模拟 React 正常交替提交两棵树。 */
function pairTrees(page, oldItems, newItems) {
  const oldRoot = page.commit(oldItems);
  const nodes = [...page.document.querySelectorAll('a')];
  const oldHosts = nodes.map(node => node.__reactFiber$test);
  const currentRoot = page.commit(newItems);
  oldRoot.alternate = currentRoot;
  currentRoot.alternate = oldRoot;
  oldRoot.stateNode = currentRoot.stateNode;
  nodes.forEach((node, index) => {
    const oldHost = oldHosts[index], newHost = node.__reactFiber$test;
    oldHost.alternate = newHost; newHost.alternate = oldHost;
    oldHost.return.alternate = newHost.return; newHost.return.alternate = oldHost.return;
    node.__reactFiber$test = oldHost;
  });
  return { oldRoot, currentRoot, oldHosts };
}

test('DOM 指向旧 fiber 时只使用 current 分支，不按较新日期猜测当前值', async t => {
  const page = createPage(t, section('Recents', ['a', 'b']), []);
  const {oldRoot,currentRoot} = pairTrees(page,
    [conversation('a'), conversation('b', 8)], [conversation('a', 1), conversation('b')]);
  // 正文分支若被遍历会抛错，防止全站扫描带来性能问题。
  currentRoot.child.sibling.sibling = {get child() {throw new Error('不应遍历正文');}};
  await page.settle({commitRows:false});
  assert.deepEqual(labels(page.document), ['昨天', '今天']);
  currentRoot.stateNode.current = oldRoot;
  page.poll();
  await page.settle({commitRows:false});
  assert.deepEqual(labels(page.document), ['今天', '上周']);
});

test('React bailout 共用子树且 return 仍指向旧父节点时也读取当前祖先', async t => {
  const page = createPage(t, section('Recents', ['a']), []);
  const {oldRoot,currentRoot,oldHosts} = pairTrees(page, [conversation('a', 8)], [conversation('a', 1)]);
  currentRoot.child.child = oldHosts[0];
  assert.equal(oldHosts[0].return, oldRoot.child);
  await page.settle({commitRows:false});
  assert.deepEqual(labels(page.document), ['昨天']);
});

test('已脱离 current 树的行以及会话 ID 不一致的 prop 不被误分组', async t => {
  const page = createPage(t, section('Recents', ['a', 'b']), []);
  const root = page.commit([conversation('a'),conversation('b')]);
  root.child.memoizedProps.conversation = conversation('different');
  root.child.sibling = null;
  await page.settle({commitRows:false});
  assert.deepEqual(labels(page.document), []);
  assert.deepEqual(page.requests, []);
});
