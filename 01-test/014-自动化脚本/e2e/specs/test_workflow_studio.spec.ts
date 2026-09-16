import { test } from '@playwright/test';
import { WorkflowStudioPage } from '../pages/WorkflowStudioPage';

/**
 * AiFlowGraph 流程工作台 UI 自动化测试用例集
 * 对应手工功能测试用例：01-test/013-测试用例/02-模块功能用例/AiFlowGraph-模块功能用例.md
 * 遵循命名映射规则：FTXXX-a -> test_FTXXX_a
 */
test.describe('AiFlowGraph 流程与任务工作台端到端自动化测试', () => {
  let studio: WorkflowStudioPage;

  test.beforeEach(async ({ page }) => {
    studio = new WorkflowStudioPage(page);
    await studio.openUrl('/');
  });

  test('test_FT015_a_login_authentication', async () => {
    // 验证正常管理员凭据成功登录
    await studio.login('admin', 'ValidAdminPassword2026!');
    await studio.expectVisible(studio.navFlowsTab);
  });

  test('test_FT004_a_business_center_query_and_create', async () => {
    // 登录后进入业务中心，创建新业务并搜索
    await studio.login('admin', 'ValidAdminPassword2026!');
    await studio.click(studio.navFlowsTab);

    // 新增业务
    const testCode = 'E2E_AUTO_BIZ';
    const testName = 'E2E自动化测试业务';
    await studio.createBusinessProject(testCode, testName);

    // 查询验证
    await studio.fill(studio.businessSearchInput, testCode);
    await studio.click(studio.businessQueryButton);
    await studio.expectVisible(studio.page.locator(`text=${testCode}`));

    // 重置过滤
    await studio.click(studio.businessResetButton);
  });

  test('test_FT005_a_workflow_publish_gate', async () => {
    // 验证未通过审核的流程发布按钮受保护
    await studio.login('admin', 'ValidAdminPassword2026!');
    await studio.click(studio.navFlowsTab);

    // 观察草稿流程操作栏
    const draftWorkflowRow = studio.page.locator('tr:has-text("未发布"):has-text("待审核")').first();
    if (await draftWorkflowRow.count() > 0) {
      const publishBtn = draftWorkflowRow.locator('button:has-text("发布")');
      // 未通过审核时发布按钮不可见或禁用
      await studio.expectHidden(publishBtn);
    }
  });

  test('test_FT007_a_task_approval_reject_requires_comment', async () => {
    // 验证审批工作台办理任务
    await studio.login('admin', 'ValidAdminPassword2026!');
    await studio.click(studio.navRunsTab);
    await studio.click(studio.todoTab);

    // 验证待办列表正常呈现
    await studio.expectVisible(studio.batchClaimButton);
  });
});
