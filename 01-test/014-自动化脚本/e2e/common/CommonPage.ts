/**
 * 公共 API（Layer 1）：基于 Playwright 封装的通用 UI 操作库。
 *
 * 本文件由 ui-automation-testcase-generator 技能首次运行时从 templates/e2e/ 拷贝至
 * 输出根目录的 common/CommonPage.ts，跨模块共享。
 *
 * 只读约束（重要）：
 * - 本文件为公共 API，测试用例/页面对象（UserPage 等）只能调用，禁止修改本文件内容。
 * - 生成器输出的测试脚本与页面对象必须优先调用本类方法（openUrl / click / fill /
 *   screenshot / expectVisible 等），禁止重复实现等价的操作/断言逻辑
 *   （禁止直接调用 page.goto、禁止直接调用 expect(locator).toBeVisible 等）。
 * - 业务流程可在 pages/UserPage.ts 的 UserPage(CommonPage) 中扩展，但不得修改本基类。
 *
 * 测试用例使用示例：
 *   const page = new CommonPage(page);
 *   await page.openUrl('/login');
 *   await page.fill(loginPage.usernameInput, 'admin');
 *   await page.click(loginPage.submitBtn);
 *   await page.expectVisible(loginPage.dashboard);
 *   await page.expectUrl(/dashboard/);
 *   await page.screenshot('after-login');
 */
import { Page, Locator, expect } from '@playwright/test';

export class CommonPage {
  protected page: Page;

  /**
   * 初始化公共 API 实例。
   *
   * @param page - Playwright 的 Page 对象，通常来自 fixture 或构造时传入。
   */
  constructor(page: Page) {
    this.page = page;
  }

  // ===== 导航 =====
  /**
   * 打开指定 URL 并等待页面加载完成。
   *
   * @param url - 目标地址，可以是相对路径（'/login'）或完整 URL。
   * @returns 无返回值（Promise<void>）。
   */
  async openUrl(url: string): Promise<void> {
    await this.page.goto(url);
  }

  /**
   * 获取当前页面的 URL。
   *
   * @returns 当前页面完整 URL 字符串。
   */
  async getUrl(): Promise<string> {
    return this.page.url();
  }

  /**
   * 获取当前页面的标题（<title>）。
   *
   * @returns 当前页面标题字符串。
   */
  async getTitle(): Promise<string> {
    return await this.page.title();
  }

  /**
   * 重新加载当前页面。
   *
   * @returns 无返回值（Promise<void>）。
   */
  async reload(): Promise<void> {
    await this.page.reload();
  }

  /**
   * 回退到浏览器历史中的上一页。
   *
   * @returns 无返回值（Promise<void>）。
   */
  async goBack(): Promise<void> {
    await this.page.goBack();
  }

  /**
   * 前进到浏览器历史中的下一页。
   *
   * @returns 无返回值（Promise<void>）。
   */
  async goForward(): Promise<void> {
    await this.page.goForward();
  }

  // ===== 元素交互 =====
  /**
   * 点击指定元素。等待元素可见、可点击后执行点击。
   *
   * @param locator - Playwright Locator，目标元素定位器。
   * @returns 无返回值（Promise<void>）。
   */
  async click(locator: Locator): Promise<void> {
    await locator.click();
  }

  /**
   * 在可输入元素中填入文本（会先清空原内容）。
   *
   * @param locator - 目标输入框定位器。
   * @param value - 要填入的文本字符串。
   * @returns 无返回值（Promise<void>）。
   */
  async fill(locator: Locator, value: string): Promise<void> {
    await locator.fill(value);
  }

  /**
   * 清空指定输入框的内容（等价于 fill('')）。
   *
   * @param locator - 目标输入框定位器。
   * @returns 无返回值（Promise<void>）。
   */
  async clear(locator: Locator): Promise<void> {
    await locator.fill('');
  }

  /**
   * 获取指定元素的文本内容。
   *
   * @param locator - 目标元素定位器。
   * @returns 元素的 textContent；不存在时返回空字符串 ''。
   */
  async getText(locator: Locator): Promise<string> {
    return (await locator.textContent()) ?? '';
  }

  /**
   * 获取指定元素的某个 HTML 属性值。
   *
   * @param locator - 目标元素定位器。
   * @param attr - 属性名，例如 'href'、'value'、'data-id'。
   * @returns 属性值字符串；属性不存在时返回 null。
   */
  async getAttribute(locator: Locator, attr: string): Promise<string | null> {
    return await locator.getAttribute(attr);
  }

  /**
   * 在 <select> 下拉框中选中指定选项。
   *
   * @param locator - <select> 元素定位器。
   * @param value - 要选中的选项值（对应 <option value="...">）。
   * @returns 无返回值（Promise<void>）。
   */
  async selectOption(locator: Locator, value: string): Promise<void> {
    await locator.selectOption(value);
  }

  /**
   * 勾选指定的复选框/单选框（已勾选则保持不变）。
   *
   * @param locator - 目标 input[type=checkbox|radio] 定位器。
   * @returns 无返回值（Promise<void>）。
   */
  async check(locator: Locator): Promise<void> {
    await locator.check();
  }

  /**
   * 取消勾选指定的复选框（未勾选则保持不变）。
   *
   * @param locator - 目标 input[type=checkbox] 定位器。
   * @returns 无返回值（Promise<void>）。
   */
  async uncheck(locator: Locator): Promise<void> {
    await locator.uncheck();
  }

  /**
   * 在当前页面按下并释放某个键盘按键。
   *
   * @param key - 按键名称，例如 'Enter'、'Escape'、'ArrowDown'。
   *   完整列表见 Playwright 键盘按键文档。
   * @returns 无返回值（Promise<void>）。
   */
  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  /**
   * 将鼠标悬停在指定元素上（触发 hover 事件）。
   *
   * @param locator - 目标元素定位器。
   * @returns 无返回值（Promise<void>）。
   */
  async hover(locator: Locator): Promise<void> {
    await locator.hover();
  }

  // ===== 截图 =====
  /**
   * 对当前页面截图并保存到 reports/ 目录。
   *
   * @param name - 可选，截图文件名（不含扩展名）。传入时保存为 reports/{name}.png；
   *   不传时仅返回 Buffer 不落盘。
   * @returns 截图的二进制数据 Buffer。
   */
  async screenshot(name?: string): Promise<Buffer> {
    return await this.page.screenshot({ path: name ? `reports/${name}.png` : undefined });
  }

  // ===== 等待 =====
  /**
   * 等待指定元素进入某种状态（默认 visible）。
   *
   * @param locator - 目标元素定位器。
   * @param state - 期望状态，可选值：'visible' | 'hidden' | 'attached' | 'detached'。
   *   默认 'visible'。
   * @returns 无返回值（Promise<void>）。
   */
  async waitFor(
    locator: Locator,
    state: 'visible' | 'hidden' | 'attached' | 'detached' = 'visible',
  ): Promise<void> {
    await locator.waitFor({ state });
  }

  /**
   * 强制等待指定毫秒数。仅用于不可预测的时序场景，优先使用 waitFor。
   *
   * @param ms - 等待毫秒数。
   * @returns 无返回值（Promise<void>）。
   */
  async waitForTimeout(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  // ===== 断言 =====
  /**
   * 断言指定元素可见（存在且可见）。
   *
   * @param locator - 目标元素定位器。
   * @returns 无返回值（Promise<void>），断言失败时抛出 AssertionError。
   */
  async expectVisible(locator: Locator): Promise<void> {
    await expect(locator).toBeVisible();
  }

  /**
   * 断言指定元素不可见（不存在或 display:none）。
   *
   * @param locator - 目标元素定位器。
   * @returns 无返回值（Promise<void>），断言失败时抛出 AssertionError。
   */
  async expectHidden(locator: Locator): Promise<void> {
    await expect(locator).toBeHidden();
  }

  /**
   * 断言指定元素可点击（已启用、未 disabled）。
   *
   * @param locator - 目标元素定位器。
   * @returns 无返回值（Promise<void>），断言失败时抛出 AssertionError。
   */
  async expectClickable(locator: Locator): Promise<void> {
    await expect(locator).toBeEnabled();
  }

  /**
   * 断言指定元素的文本内容等于期望值（严格匹配）。
   *
   * @param locator - 目标元素定位器。
   * @param expected - 期望的文本字符串。
   * @returns 无返回值（Promise<void>），断言失败时抛出 AssertionError。
   */
  async expectText(locator: Locator, expected: string): Promise<void> {
    await expect(locator).toHaveText(expected);
  }

  /**
   * 断言指定输入框的值等于期望值。
   *
   * @param locator - 目标 input/textarea 定位器。
   * @param expected - 期望的 value 值。
   * @returns 无返回值（Promise<void>），断言失败时抛出 AssertionError。
   */
  async expectValue(locator: Locator, expected: string): Promise<void> {
    await expect(locator).toHaveValue(expected);
  }

  /**
   * 断言当前页面 URL 匹配期望值（字符串严格相等或正则匹配）。
   *
   * @param expected - 期望的 URL，字符串（严格相等）或 RegExp（正则匹配）。
   * @returns 无返回值（Promise<void>），断言失败时抛出 AssertionError。
   */
  async expectUrl(expected: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(expected);
  }

  /**
   * 断言当前页面标题匹配期望值（字符串严格相等或正则匹配）。
   *
   * @param expected - 期望的标题，字符串（严格相等）或 RegExp（正则匹配）。
   * @returns 无返回值（Promise<void>），断言失败时抛出 AssertionError。
   */
  async expectTitle(expected: string | RegExp): Promise<void> {
    await expect(this.page).toHaveTitle(expected);
  }

  /**
   * 断言匹配指定定位器的元素数量等于期望值。
   *
   * @param locator - 目标元素定位器。
   * @param count - 期望的元素数量。
   * @returns 无返回值（Promise<void>），断言失败时抛出 AssertionError。
   */
  async expectCount(locator: Locator, count: number): Promise<void> {
    await expect(locator).toHaveCount(count);
  }
}
