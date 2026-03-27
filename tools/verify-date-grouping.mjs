/**
 * 这个脚本用于在浏览器中注入 userscript，
 * 验证新版 ChatGPT 侧栏是否已经恢复日期分组。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const execFileAsync = promisify(execFile);
const PROJECT_DIR = path.resolve(import.meta.dirname, '..');
const ARTIFACTS_DIR = path.join(PROJECT_DIR, 'artifacts');
const USER_SCRIPT_PATH = path.join(PROJECT_DIR, 'ChatGPT Bring Back Date Grouping.user.js');

/**
 * 导出当前 Chrome 中的 ChatGPT cookie。
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
 * 读取最近访问的 ChatGPT 对话页地址。
 * @returns {Promise<string>} 最近对话 URL
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
 * 等待历史列表出现。
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
 * 展开新版侧栏。
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
  }
  await page.waitForTimeout(2500);
  await waitForHistoryList(page);
}

/**
 * 注入 userscript 所需的最小 GM API。
 * @param {import('playwright-core').Page} page 页面对象
 */
async function installUserScriptShim(page) {
  await page.addInitScript(() => {
    window.GM_addStyle = cssText => {
      const style = document.createElement('style');
      style.textContent = String(cssText);
      document.head.appendChild(style);
    };
  });
}

async function main() {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false
  });
  const context = await browser.newContext();

  try {
    const cookies = await loadChatGptCookies();
    const recentChatUrl = await loadRecentChatUrl();
    const userScriptSource = await fs.readFile(USER_SCRIPT_PATH, 'utf8');

    await context.addCookies(cookies);

    const page = await context.newPage();
    await installUserScriptShim(page);

    await page.goto(recentChatUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await openSidebarAndWait(page);

    await page.evaluate(source => {
      window.eval(source);
    }, userScriptSource);
    await page.waitForTimeout(1500);

    const verification = await page.evaluate(() => {
      const headers = [...document.querySelectorAll('#history .__chat-group-header')].map(node => node.textContent?.trim() ?? '');
      const anchors = [...document.querySelectorAll('#history a[href^="/c/"]')].slice(0, 12).map(node => node.textContent?.trim() ?? '');
      return {
        headerCount: headers.length,
        headers,
        sampleAnchors: anchors
      };
    });

    const screenshotPath = path.join(ARTIFACTS_DIR, 'date-grouping-verification.png');
    const reportPath = path.join(ARTIFACTS_DIR, 'date-grouping-verification.json');

    await page.screenshot({ path: screenshotPath, fullPage: true });
    await fs.writeFile(reportPath, `${JSON.stringify(verification, null, 2)}\n`, 'utf8');

    console.log(`Verification screenshot: ${screenshotPath}`);
    console.log(`Verification report: ${reportPath}`);
    console.log(`Header count: ${verification.headerCount}`);
    console.log(`Headers: ${verification.headers.join(', ')}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
