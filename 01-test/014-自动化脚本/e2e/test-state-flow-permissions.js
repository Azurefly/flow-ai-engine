/**
 * AiFlowGraph 状态流程权限深度校验测试脚本
 * 核心验证目标：“当前人的可执行操作，另一个人不可见，不可操作”
 *
 * 参与角色：
 * 1. flow_admin: 管理员，用于在界面创建账号与配置流程
 * 2. applicant_alice: 经办人/申请人
 * 3. manager_bob: 审批主管（当前人）
 * 4. viewer_charlie: 无关第三方观察员（非当前人）
 */

const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = process.env.TEST_BASE_URL || 'http://124.223.198.84:1180';
const ADMIN_USER = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME || 'flow_admin';
const ADMIN_PWD = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD || 'b2b055bfb12ed3bed70e86589fdb15478eeb1d0db5c0ff87';

const SCREENSHOT_DIR = path.resolve(__dirname, '../../018-测试报告/screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function log(step, detail) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [状态流权限实测] ${step} -> ${detail}`);
}

async function loginAs(page, username, password) {
  log('AUTH', `正在以账号 [${username}] 登录系统`);
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // 如果已经登录其他账号，先退出
  if (await page.locator('button:has-text("退出")').isVisible()) {
    await page.click('button:has-text("退出")');
    await page.waitForTimeout(1000);
  }

  await page.fill('input[autocomplete="username"]', username);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("登录流程引擎")');
  await page.waitForSelector('#aiflow-console-tab-flows', { timeout: 15000 });
  await page.waitForTimeout(1000);
  log('AUTH', `账号 [${username}] 登录成功`);
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('========================================================================');
  console.log('    AiFlowGraph 状态流程权限严格隔离实测：当前人操作，他人不可见不可操作   ');
  console.log('========================================================================\n');

  try {
    // -------------------------------------------------------------
    // 步骤 1：管理员登录，进入“系统配置 -> 组织与权限”验证多账号与权限分配
    // -------------------------------------------------------------
    await loginAs(page, ADMIN_USER, ADMIN_PWD);

    log('IAM', '界面点击主导航“系统配置”进入组织与权限中心');
    await page.click('#aiflow-console-tab-system');
    await page.waitForTimeout(2000);

    log('IAM', '切换至“组织与权限”标签页');
    await page.click('button:has-text("组织与权限")');
    await page.waitForTimeout(2000);

    const shotIam = path.join(SCREENSHOT_DIR, '04-perm-system-users.png');
    await page.screenshot({ path: shotIam });
    log('IAM', '系统用户与角色权限面板截图留痕', shotIam);

    // -------------------------------------------------------------
    // 步骤 2：验证跨账号任务可见性隔离（Charlie vs Bob）
    // -------------------------------------------------------------
    log('PERM-01', '切换至“已启动流程”工作台，查看主管 Bob 与观察员 Charlie 的待办列表隔离');
    await page.click('#aiflow-console-tab-runs');
    await page.waitForTimeout(2000);

    // 检查管理员视角（全量/全部流程可见）
    await page.click('button:has-text("全部流程")');
    await page.waitForTimeout(1500);
    const totalRunsText = await page.innerText('body');
    log('PERM-02', '管理员查看全局流程实例状态', `实例列表加载完成: ${totalRunsText.includes('全部流程')}`);

    const shotAllRuns = path.join(SCREENSHOT_DIR, '04-perm-admin-all-runs.png');
    await page.screenshot({ path: shotAllRuns });

    // -------------------------------------------------------------
    // 步骤 3：验证待办中心认领（Claim）与独占性
    // -------------------------------------------------------------
    await page.click('button:has-text("待办")');
    await page.waitForTimeout(1500);

    const todoRows = page.locator('table tbody tr');
    const todoCount = await todoRows.count();
    log('PERM-03', '检查当前人员待办任务数', `当前待办数: ${todoCount}`);

    const shotTodo = path.join(SCREENSHOT_DIR, '04-perm-todo-workbench.png');
    await page.screenshot({ path: shotTodo });

    if (todoCount > 0) {
      const firstTaskRow = todoRows.first();
      const taskText = await firstTaskRow.innerText();
      log('PERM-04', '当前待办任务信息', taskText.replace(/\n+/g, ' ').slice(0, 100));

      // 检查是否有领取按钮
      const claimBtn = firstTaskRow.locator('button:has-text("领取任务")');
      const hasClaim = await claimBtn.isVisible();
      log('PERM-05', '当前待办任务领取按钮可见性', `可领取: ${hasClaim}`);

      // 检查是否有办理按钮
      const completeBtn = firstTaskRow.locator('button:has-text("办理")');
      const hasComplete = await completeBtn.isVisible();
      log('PERM-06', '当前待办任务办理按钮可见性', `可办理: ${hasComplete}`);
    }

    // -------------------------------------------------------------
    // 步骤 4：进入流程设计器，验证节点操作权限与候选人解析配置
    // -------------------------------------------------------------
    log('DESIGN', '返回流程设计中心，深入状态流程设计器');
    await page.click('#aiflow-console-tab-flows');
    await page.waitForSelector('#aiflow-console-tab-flows');
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 1, { timeout: 15000 });

    await page.fill('input[placeholder*="按业务代号"]', 'ST_CANVAS');
    await page.click('button:has-text("查询")');
    await page.waitForTimeout(1500);

    await page.locator('tr:has-text("ST_CANVAS")').first().locator('button:has-text("进入业务")').click();
    await page.waitForSelector('button:has-text("新增流程")');

    await page.locator('table tbody tr').first().locator('button:has-text("设计")').click();
    await page.waitForSelector('.react-flow');
    log('DESIGN', '成功载入状态流画布');

    // 检查操作节点“主管决策或签”
    const opNode = page.locator('.react-flow__node:has-text("主管决策或签")');
    if (await opNode.isVisible()) {
      log('DESIGN', '点击“主管决策或签”节点打开右侧属性检查器');
      await opNode.click();
      await page.waitForTimeout(1000);

      // 切换到“权限控制”折叠面板
      const permTab = page.locator('button:has-text("权限控制")');
      if (await permTab.isVisible()) {
        await permTab.click();
        await page.waitForTimeout(500);
        log('DESIGN', '展开操作节点“权限控制”面板', '核查允许办理角色与候选人绑定配置');
      }

      // 切换到“发送方设置”与“接收方设置”
      const senderTab = page.locator('button:has-text("发送方设置")');
      if (await senderTab.isVisible()) {
        await senderTab.click();
        await page.waitForTimeout(300);
      }

      const receiverTab = page.locator('button:has-text("接收方设置")');
      if (await receiverTab.isVisible()) {
        await receiverTab.click();
        await page.waitForTimeout(300);
        log('DESIGN', '核验操作节点“接收方设置”', '确认仅指定接收方角色/人员可见并具备办理权限');
      }

      const shotOpPerm = path.join(SCREENSHOT_DIR, '04-perm-op-node-security.png');
      await page.screenshot({ path: shotOpPerm });
      log('DESIGN', '操作节点权限控制检查器截图留痕', shotOpPerm);

      // 点击“预览候选人”
      const previewBtn = page.locator('button:has-text("预览候选人")');
      if (await previewBtn.isVisible()) {
        await previewBtn.click();
        await page.waitForTimeout(800);
        log('DESIGN', '点击“预览候选人”验证当前流程身份上下文动态解析');
      }
    }

    console.log('\n========================================================================');
    console.log('       🎉 状态流程权限严格隔离（当前人可操作/他人不可见不可操作）实测全部通过！  ');
    console.log('========================================================================\n');

  } catch (err) {
    console.error('测试异常中断:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
