# E2E UI 自动化测试框架

基于 Playwright 的端到端测试框架，遵循 Page Object 模式。

## 架构：两层 API

- **公共 API（Layer 1，共享）**：`common/CommonPage.ts` 的 `CommonPage`，封装打开 URL、点击、输入、截图、元素可见/可点击断言等通用操作，跨模块复用。
- **用户级 API（Layer 2，可选）**：`pages/UserPage.ts` 的 `UserPage(CommonPage)`，承载业务自定义方法，由生成技能按需创建。
- **页面对象**：`pages/{PageName}Page.ts` 继承 `UserPage`（或直接继承 `CommonPage`），封装页面元素与复合操作。
- **测试用例**：`specs/test_*.spec.ts`，优先调用公共 API。

## 只读约束（重要）

- `common/CommonPage.ts` 为公共 API，**测试用例与页面对象（UserPage 等）只能调用，禁止修改本文件内容**。
- 生成器输出的测试脚本与页面对象必须优先调用本类方法（`openUrl` / `click` / `fill` / `screenshot` / `expectVisible` 等），**禁止重复实现等价的操作/断言逻辑**（禁止直接调用 `page.goto`、禁止直接调用 `expect(locator).toBeVisible` 等）。
- 业务流程只能在 `pages/UserPage.ts` 的 `UserPage(CommonPage)` 中扩展，**不得修改 `common/` 基类**。

## 使用说明

1. 安装依赖：`npm install`
2. 配置环境变量：复制 `.env.example` 为 `.env`
3. 安装浏览器：`npx playwright install`
4. 运行测试：`npx playwright test`
5. 预览报告：`npx playwright show-report`

## 公共 API 方法清单（CommonPage）

> 以下方法均定义在 `common/CommonPage.ts`。所有方法已带完整中文 JSDoc（@param/@returns/说明），IDE 悬停即可查看。**只读使用，禁止修改实现**。

### 导航

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `constructor(page)` | `page: Page` Playwright Page 对象 | 无 | 初始化实例 |
| `openUrl(url)` | `url: string` 目标地址（相对或完整） | `Promise<void>` | 打开指定 URL 并等待加载完成 |
| `getUrl()` | 无 | `Promise<string>` | 当前页面 URL |
| `getTitle()` | 无 | `Promise<string>` | 当前页面标题（<title>） |
| `reload()` | 无 | `Promise<void>` | 重新加载当前页面 |
| `goBack()` | 无 | `Promise<void>` | 回退到上一页 |
| `goForward()` | 无 | `Promise<void>` | 前进到下一页 |

### 元素交互

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `click(locator)` | `locator: Locator` 目标元素 | `Promise<void>` | 点击元素（等待可见可点击后执行） |
| `fill(locator, value)` | `locator: Locator`；`value: string` 文本 | `Promise<void>` | 在输入框填入文本（先清空原内容） |
| `clear(locator)` | `locator: Locator` 输入框 | `Promise<void>` | 清空输入框内容（等价于 fill('')） |
| `getText(locator)` | `locator: Locator` 目标元素 | `Promise<string>` | 元素文本内容；不存在返回 '' |
| `getAttribute(locator, attr)` | `locator: Locator`；`attr: string` 属性名 | `Promise<string \| null>` | 元素属性值；不存在返回 null |
| `selectOption(locator, value)` | `locator: Locator`；`value: string` 选项值 | `Promise<void>` | 在 <select> 中选中指定选项 |
| `check(locator)` | `locator: Locator` 复选框/单选框 | `Promise<void>` | 勾选（已勾选则保持） |
| `uncheck(locator)` | `locator: Locator` 复选框 | `Promise<void>` | 取消勾选（未勾选则保持） |
| `pressKey(key)` | `key: string` 按键名，如 'Enter' | `Promise<void>` | 按下并释放键盘按键 |
| `hover(locator)` | `locator: Locator` 目标元素 | `Promise<void>` | 鼠标悬停在元素上 |

### 截图

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `screenshot(name?)` | `name: string` 可选文件名（不含扩展名） | `Promise<Buffer>` | 页面截图；传 name 时保存为 reports/{name}.png，不传时仅返回 Buffer |

### 等待

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `waitFor(locator, state='visible')` | `locator: Locator`；`state: 'visible'\|'hidden'\|'attached'\|'detached'` | `Promise<void>` | 等待元素进入指定状态 |
| `waitForTimeout(ms)` | `ms: number` 毫秒数 | `Promise<void>` | 强制等待（优先使用 waitFor） |

### 断言

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `expectVisible(locator)` | `locator: Locator` | `Promise<void>` | 断言元素可见 |
| `expectHidden(locator)` | `locator: Locator` | `Promise<void>` | 断言元素不可见 |
| `expectClickable(locator)` | `locator: Locator` | `Promise<void>` | 断言元素可点击（已启用） |
| `expectText(locator, expected)` | `locator: Locator`；`expected: string` | `Promise<void>` | 断言元素文本等于期望（严格匹配） |
| `expectValue(locator, expected)` | `locator: Locator`；`expected: string` | `Promise<void>` | 断言输入框 value 等于期望 |
| `expectUrl(expected)` | `expected: string \| RegExp` URL 或正则 | `Promise<void>` | 断言当前 URL 匹配期望 |
| `expectTitle(expected)` | `expected: string \| RegExp` 标题或正则 | `Promise<void>` | 断言当前标题匹配期望 |
| `expectCount(locator, count)` | `locator: Locator`；`count: number` | `Promise<void>` | 断言匹配元素数量等于期望 |

## 典型用法

```typescript
import { CommonPage } from '../common/CommonPage';
import { LoginPage } from '../pages/LoginPage';

test('登录成功', async ({ page }) => {
  const loginPage = new LoginPage(page);  // LoginPage extends CommonPage
  await loginPage.openUrl('/login');
  await loginPage.fill(loginPage.usernameInput, 'admin');
  await loginPage.fill(loginPage.passwordInput, 'Pass1234');
  await loginPage.click(loginPage.submitBtn);
  await loginPage.expectVisible(loginPage.dashboard);
  await loginPage.expectUrl(/dashboard/);
  await loginPage.screenshot('after-login');
});
```
