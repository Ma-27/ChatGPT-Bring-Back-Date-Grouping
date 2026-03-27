/**
 * 这个脚本用于在本机 Chrome 登录态副本中打开 ChatGPT，
 * 抓取侧栏 DOM 结构与会话列表数据，帮助 userscript 适配新版页面。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const execFileAsync = promisify(execFile);
const PROJECT_DIR = path.resolve(import.meta.dirname, '..');
const ARTIFACTS_DIR = path.join(PROJECT_DIR, 'artifacts');

/**
 * 通过 Python 辅助脚本导出浏览器 cookie。
 * 这样可以直接复用用户当前登录态，而不用复制整个 Chrome 配置目录。
 * @returns {Promise<object[]>} Playwright 兼容 cookie 列表
 */
async function loadChatGptCookies() {
  const helperPath = path.join(PROJECT_DIR, 'tools', 'export_chatgpt_cookies.py');
  const { stdout } = await execFileAsync('python3', [helperPath], {
    cwd: PROJECT_DIR,
    maxBuffer: 10 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

/**
 * 读取最近访问的 ChatGPT 对话 URL，提升调试命中率。
 * @returns {Promise<string>} 最近访问的对话地址
 */
async function loadRecentChatUrl() {
  const helperPath = path.join(PROJECT_DIR, 'tools', 'export_recent_chat_url.py');
  const { stdout } = await execFileAsync('python3', [helperPath], {
    cwd: PROJECT_DIR,
    maxBuffer: 1024 * 1024
  });
  return stdout.trim();
}

/**
 * 在页面上下文中提取调试所需的侧栏信息。
 * 这里优先采集结构、属性和文本，而不是依赖具体样式类名。
 * @returns {Promise<object>} 侧栏诊断信息
 */
async function extractSidebarSnapshot(page) {
  return page.evaluate(async () => {
    const historyRoot = document.querySelector('#history');
    const sidebar = historyRoot?.closest('nav, aside, [data-sidebar], [data-testid], [role="navigation"]') ?? null;
    const conversationAnchors = [...document.querySelectorAll('a[href^="/c/"]')];
    const localStorageEntries = (() => {
      const entries = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key) {
          continue;
        }
        if (key.includes('conversation-history') || key.includes('snorlax-history') || key.includes('starred-conversations')) {
          entries.push({
            key,
            value: localStorage.getItem(key)
          });
        }
      }
      return entries;
    })();
    const reactDebug = (() => {
      const anchor = conversationAnchors[0];
      if (!(anchor instanceof HTMLElement)) {
        return null;
      }

      const fiberKey = Object.keys(anchor).find(key => key.startsWith('__reactFiber$')) ?? null;
      const propsKey = Object.keys(anchor).find(key => key.startsWith('__reactProps$')) ?? null;

      const ancestorSummaries = [];
      let current = anchor;
      let depth = 0;
      while (current && depth < 8) {
        const currentFiberKey = Object.keys(current).find(key => key.startsWith('__reactFiber$')) ?? null;
        const currentPropsKey = Object.keys(current).find(key => key.startsWith('__reactProps$')) ?? null;
        const fiber = currentFiberKey ? current[currentFiberKey] : null;
        const props = currentPropsKey ? current[currentPropsKey] : null;
        ancestorSummaries.push({
          depth,
          tag: current.tagName,
          className: current.className || null,
          fiberKey: currentFiberKey,
          propsKey: currentPropsKey,
          propKeys: props ? Object.keys(props).slice(0, 20) : [],
          memoizedPropKeys: fiber?.memoizedProps ? Object.keys(fiber.memoizedProps).slice(0, 20) : [],
          hasConversationProp: Boolean(props?.conversation || fiber?.memoizedProps?.conversation)
        });
        current = current.parentElement;
        depth += 1;
      }

      return {
        fiberKey,
        propsKey,
        ancestorSummaries
      };
    })();
    const buttons = [...document.querySelectorAll('button')].slice(0, 60).map((button, index) => ({
      index,
      text: button.textContent?.trim() ?? '',
      ariaLabel: button.getAttribute('aria-label'),
      title: button.getAttribute('title'),
      className: button.className,
      dataTestId: button.getAttribute('data-testid'),
      sectionTrail: (() => {
        const names = [];
        let current = button.parentElement;
        let depth = 0;
        while (current && depth < 5) {
          names.push({
            tag: current.tagName,
            id: current.id || null,
            className: current.className || null,
            role: current.getAttribute('role'),
            dataTestId: current.getAttribute('data-testid')
          });
          current = current.parentElement;
          depth += 1;
        }
        return names;
      })()
    }));
    const navs = [...document.querySelectorAll('nav, aside, [role="navigation"]')].slice(0, 20).map((node, index) => ({
      index,
      tag: node.tagName,
      id: node.id || null,
      className: node.className || null,
      dataTestId: node.getAttribute('data-testid'),
      text: node.textContent?.trim().slice(0, 500) ?? '',
      html: node.outerHTML.slice(0, 5000)
    }));
    const backendApiResponse = await fetch('/backend-api/conversations?offset=0&limit=10&order=updated')
      .then(async response => ({
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: await response.text()
      }))
      .catch(error => ({
        ok: false,
        status: -1,
        contentType: null,
        body: String(error)
      }));
    const conversations = conversationAnchors.slice(0, 30).map((anchor, index) => ({
      index,
      href: anchor.getAttribute('href'),
      text: anchor.textContent?.trim() ?? '',
      className: anchor.className,
      dataset: { ...anchor.dataset },
      ariaLabel: anchor.getAttribute('aria-label'),
      parentTag: anchor.parentElement?.tagName ?? null,
      parentClassName: anchor.parentElement?.className ?? null,
      sectionTrail: (() => {
        const names = [];
        let current = anchor.parentElement;
        let depth = 0;
        while (current && depth < 6) {
          names.push({
            tag: current.tagName,
            id: current.id || null,
            className: current.className || null,
            role: current.getAttribute('role'),
            dataTestId: current.getAttribute('data-testid')
          });
          current = current.parentElement;
          depth += 1;
        }
        return names;
      })()
    }));

    return {
      url: location.href,
      title: document.title,
      historyFound: Boolean(historyRoot),
      historyTag: historyRoot?.tagName ?? null,
      historyClassName: historyRoot?.className ?? null,
      historyChildTags: historyRoot ? [...historyRoot.children].map(node => node.tagName) : [],
      historyHtml: historyRoot?.outerHTML?.slice(0, 20000) ?? null,
      sidebarHtml: sidebar?.outerHTML?.slice(0, 20000) ?? null,
      conversationCount: conversationAnchors.length,
      conversations,
      buttons,
      navs,
      backendApiResponse,
      reactDebug,
      localStorageEntries
    };
  });
}

/**
 * 在页面中轮询等待历史列表出现。
 * 这里不依赖单次时序，尽量等到新版边栏真正完成挂载。
 * @param {import('playwright-core').Page} page 页面对象
 */
async function waitForHistoryList(page) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const hasHistoryItems = await page.evaluate(() => {
      return Boolean(document.querySelector('#history a[href^="/c/"]'));
    });
    if (hasHistoryItems) {
      return;
    }
    await page.waitForTimeout(500);
  }
}

/**
 * 尝试展开新版侧边栏并等待历史列表挂载。
 * @param {import('playwright-core').Page} page 页面对象
 */
async function openSidebarAndWait(page) {
  const hasOpenSidebarButton = await page
    .locator('button[aria-label="打开边栏"], button[aria-label="Open sidebar"]')
    .count();
  if (hasOpenSidebarButton > 0) {
    await page.evaluate(() => {
      const trigger = document.querySelector('button[aria-label="打开边栏"], button[aria-label="Open sidebar"]');
      if (trigger instanceof HTMLButtonElement) {
        trigger.click();
      }
    });
    await page.waitForTimeout(3000);
  }
  await waitForHistoryList(page);
}

async function main() {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false
  });
  const context = await browser.newContext();

  try {
    const networkLog = [];
    const cookies = await loadChatGptCookies();
    const recentChatUrl = await loadRecentChatUrl();
    await context.addCookies(cookies);

    const page = context.pages()[0] ?? await context.newPage();
    page.on('response', async response => {
      const url = response.url();
      const request = response.request();
      const isInterestingUrl =
        url.includes('chatgpt.com') &&
        (url.includes('/backend-api/') ||
          url.includes('/public-api/') ||
          url.includes('conversation') ||
          url.includes('history'));
      if (!isInterestingUrl || networkLog.length >= 50) {
        return;
      }

      let bodySnippet = null;
      try {
        const contentType = response.headers()['content-type'] ?? '';
        if (contentType.includes('json') || contentType.includes('text') || contentType.includes('html')) {
          bodySnippet = (await response.text()).slice(0, 1500);
        }
      } catch {
        bodySnippet = null;
      }

      networkLog.push({
        url,
        status: response.status(),
        resourceType: request.resourceType(),
        method: request.method(),
        contentType: response.headers()['content-type'] ?? null,
        bodySnippet
      });
    });

    let snapshot = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.goto(recentChatUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      await openSidebarAndWait(page);
      snapshot = await extractSidebarSnapshot(page);
      if (snapshot.conversationCount > 0) {
        break;
      }
    }
    if (!snapshot) {
      throw new Error('未能抓取到页面快照。');
    }
    snapshot.networkLog = networkLog;
    const outputPath = path.join(ARTIFACTS_DIR, 'sidebar-snapshot.json');
    const screenshotPath = path.join(ARTIFACTS_DIR, 'sidebar-snapshot.png');
    const htmlPath = path.join(ARTIFACTS_DIR, 'sidebar-snapshot.html');
    await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await fs.writeFile(htmlPath, await page.content(), 'utf8');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(`Snapshot saved to: ${outputPath}`);
    console.log(`Screenshot saved to: ${screenshotPath}`);
    console.log(`HTML saved to: ${htmlPath}`);
    console.log(`History found: ${snapshot.historyFound}`);
    console.log(`Conversation count: ${snapshot.conversationCount}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
