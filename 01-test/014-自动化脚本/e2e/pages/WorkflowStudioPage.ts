import { Page, Locator } from '@playwright/test';
import { CommonPage } from '../common/CommonPage';

/**
 * AiFlowGraph 流程工作台页面对象类（Layer 2 Page Object）
 * 继承 CommonPage，页面交互优先调用 CommonPage 提供的原子方法。
 */
export class WorkflowStudioPage extends CommonPage {
  // ===== 登录元素 =====
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly userAvatar: Locator;

  // ===== 顶层导航与操作 =====
  readonly navFlowsTab: Locator;
  readonly navRunsTab: Locator;
  readonly navWarehouseTab: Locator;
  readonly navSystemTab: Locator;
  readonly logoutButton: Locator;

  // ===== 业务中心 =====
  readonly createBusinessButton: Locator;
  readonly businessCodeInput: Locator;
  readonly businessNameInput: Locator;
  readonly submitBusinessButton: Locator;
  readonly businessSearchInput: Locator;
  readonly businessQueryButton: Locator;
  readonly businessResetButton: Locator;

  // ===== 流程设计器 =====
  readonly saveCanvasButton: Locator;
  readonly validateWorkflowButton: Locator;
  readonly publishWorkflowButton: Locator;
  readonly unpublishWorkflowButton: Locator;
  readonly launchWorkflowButton: Locator;
  readonly testRunModalButton: Locator;

  // ===== 任务工作台 =====
  readonly todoTab: Locator;
  readonly doneTab: Locator;
  readonly batchClaimButton: Locator;
  readonly batchApproveButton: Locator;
  readonly batchRejectButton: Locator;
  readonly taskCommentTextarea: Locator;

  constructor(page: Page) {
    super(page);
    // 登录
    this.usernameInput = page.locator('input[placeholder*="用户名"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.loginButton = page.locator('button:has-text("登录流程引擎")');
    this.userAvatar = page.locator('[data-testid="user-profile"], .user-avatar');

    // 导航
    this.navFlowsTab = page.locator('#aiflow-console-tab-flows');
    this.navRunsTab = page.locator('#aiflow-console-tab-runs');
    this.navWarehouseTab = page.locator('#aiflow-console-tab-warehouse');
    this.navSystemTab = page.locator('#aiflow-console-tab-system');
    this.logoutButton = page.locator('button[title*="退出"], button:has-text("退出登录")');

    // 业务中心
    this.createBusinessButton = page.locator('button:has-text("新增业务")');
    this.businessCodeInput = page.locator('input[placeholder*="业务代号"]');
    this.businessNameInput = page.locator('input[placeholder*="业务名称"]');
    this.submitBusinessButton = page.locator('button:has-text("保存业务")');
    this.businessSearchInput = page.locator('input[placeholder*="搜索"]');
    this.businessQueryButton = page.locator('button:has-text("查询")');
    this.businessResetButton = page.locator('button:has-text("重置")');

    // 流程设计器
    this.saveCanvasButton = page.locator('button:has-text("保存画布")');
    this.validateWorkflowButton = page.locator('button:has-text("验证"), button:has-text("检查")');
    this.publishWorkflowButton = page.locator('button:has-text("发布")');
    this.unpublishWorkflowButton = page.locator('button:has-text("取消发布")');
    this.launchWorkflowButton = page.locator('button:has-text("发起流程")');
    this.testRunModalButton = page.locator('button:has-text("试运行")');

    // 任务工作台
    this.todoTab = page.locator('button:has-text("待办")');
    this.doneTab = page.locator('button:has-text("已办")');
    this.batchClaimButton = page.locator('button:has-text("批量领取")');
    this.batchApproveButton = page.locator('button:has-text("批量同意")');
    this.batchRejectButton = page.locator('button:has-text("批量拒绝")');
    this.taskCommentTextarea = page.locator('textarea[placeholder*="处理意见"]');
  }

  /**
   * 业务级组合动作：执行登录
   */
  async login(username: string, password: string): Promise<void> {
    await this.fill(this.usernameInput, username);
    await this.fill(this.passwordInput, password);
    await this.click(this.loginButton);
  }

  /**
   * 业务级组合动作：快速新建业务项目
   */
  async createBusinessProject(code: string, name: string): Promise<void> {
    await this.click(this.createBusinessButton);
    await this.fill(this.businessCodeInput, code);
    await this.fill(this.businessNameInput, name);
    await this.click(this.submitBusinessButton);
  }
}
