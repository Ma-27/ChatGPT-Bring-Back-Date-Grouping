/** 调试工具共用的侧栏定位与展开逻辑，对应 userscript 的历史区域边界。 */
export const HISTORY_ROOT_SELECTOR = '#history, [data-app-action-sidebar-section-heading="Recents"]';
export const HISTORY_LINK_SELECTOR = `:is(${HISTORY_ROOT_SELECTOR}) a[href*="/c/"]`;

/** 展开侧栏并等待真实会话行挂载，未找到时明确报告验证失败。 */
export async function openSidebarAndWait(page) {
  if (await page.locator(HISTORY_LINK_SELECTOR).count() === 0) {
    const trigger = page.locator(
      'button[aria-label="显示侧边栏"], button[aria-label="Show sidebar"], '
      + 'button[aria-label="打开边栏"], button[aria-label="Open sidebar"]'
    ).first();
    if (await trigger.count() > 0) await trigger.click();
  }
  await page.locator(HISTORY_LINK_SELECTOR).first().waitFor({ state: 'attached', timeout: 20000 });
}
