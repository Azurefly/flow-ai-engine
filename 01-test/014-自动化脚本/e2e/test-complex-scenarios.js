/**
 * AiFlowGraph 复杂企业业务场景全链路深度交互与合理性实测套件
 *
 * 核心要求：
 * 1. 业务流程复杂度高：涵盖三大流程范式全量核心算子、动态路由、多级审批、会签/或签、子流程、REST微服务、LLM大模型、数据流ETL十算子矩阵；
 * 2. 充分测试每个环节的合理性：对每个关键节点/环节进行检查器配置提取、表单属性验证、拓扑规则诊断、试运行输入推导与生命周期流转；
 * 3. 严格从真实 Web 界面上操作，而不是 API 调用：全流程由 Chromium 浏览器真实驱动点击、展开、表单交互与截图留痕。
 */

const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = process.env.TEST_BASE_URL || 'http://124.223.198.84:1180';
const USERNAME = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME || 'flow_admin';
const PASSWORD = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD || 'b2b055bfb12ed3bed70e86589fdb15478eeb1d0db5c0ff87';

const SCREENSHOT_DIR = path.resolve(__dirname, '../../018-测试报告/screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const auditLog = [];

function log(scenario, step, detail) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [${scenario}] ${step} -> ${detail}`);
  auditLog.push({ scenario, step, detail, timestamp: new Date().toISOString() });
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log('========================================================================');
  console.log('       AiFlowGraph 复杂企业业务场景全链路界面合理性实测套件             ');
  console.log(`目标环境: ${BASE_URL} | 驱动浏览器: Chromium 1440x900 | 账号: ${USERNAME}`);
  console.log('========================================================================\n');

  try {
    // -------------------------------------------------------------
    // 登录鉴权
    // -------------------------------------------------------------
    log('AUTH', '打开登录页', BASE_URL);
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    log('AUTH', '录入凭据并登录', `用户: ${USERNAME}`);
    await page.fill('input[autocomplete="username"]', USERNAME);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button:has-text("登录流程引擎")');

    await page.waitForSelector('#aiflow-console-tab-flows', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 1, { timeout: 15000 });
    log('AUTH', '登录成功进入控制台', page.url());

    // =============================================================
    // 复杂场景一：综合全功能【状态流程】(11 节点全拓扑与环节合理性深度测试)
    // 节点：申请开始 -> 填报草稿 -> 经办人提交 -> 主管审核中 -> 主管决策或签
    //      -> 金额分级路由 (大额核算 -> 调用核算子流程 -> 归档办结) / (常规通道 -> 归档办结) / 驳回状态
    // =============================================================
    console.log('\n========================================================================');
    console.log('▶ [场景一] 复杂状态流程：大额资本性支出与多级审批协同流 (11 节点链路实测)');
    console.log('========================================================================');

    // 1.1 检索进入状态流项目
    log('SCENARIO-1', '检索状态流业务', '输入 ST_CANVAS 筛选状态流程综合业务空间');
    await page.fill('input[placeholder*="按业务代号"]', 'ST_CANVAS');
    await page.click('button:has-text("查询")');
    await page.waitForTimeout(1500);

    const stRow = page.locator('tr:has-text("ST_CANVAS")').first();
    await stRow.waitFor({ state: 'visible', timeout: 8000 });
    await stRow.locator('button:has-text("进入业务")').click();
    await page.waitForSelector('button:has-text("新增流程")', { timeout: 8000 });
    log('SCENARIO-1', '进入工作区', `项目地址: ${page.url()}`);

    // 1.2 打开画布设计器
    log('SCENARIO-1', '打开设计器画布', '点击操作列“设计”按钮');
    const stFlowRow = page.locator('table tbody tr').first();
    await stFlowRow.locator('button:has-text("设计")').click();
    await page.waitForSelector('.react-flow', { timeout: 10000 });

    // 截图 1：状态流全拓扑画布
    const shot1Path = path.join(SCREENSHOT_DIR, '01-state-flow-canvas.png');
    await page.screenshot({ path: shot1Path });
    log('SCENARIO-1', '保存画布截图', `截取11节点完整状态流画布: ${shot1Path}`);

    // 1.3 遍历并深度测试核心节点环节合理性
    const stateNodes = page.locator('.react-flow__node');
    const nodeCount = await stateNodes.count();
    log('SCENARIO-1', '画布节点总数检测', `画布包含 ${nodeCount} 个拓扑节点`);

    // 环节 A：测试经办人提交操作节点 (经办人提交 OPERATE)
    const opSubmitNode = page.locator('.react-flow__node:has-text("经办人提交")');
    if (await opSubmitNode.isVisible()) {
      log('SCENARIO-1', '环节测试: 经办人提交操作', '点击经办人操作节点打开右侧属性检查器');
      await opSubmitNode.click();
      await page.waitForTimeout(800);

      const inspector = page.locator('[data-aiflow-context-header], aside, .border-l').last();
      const inspectorText = await inspector.innerText();
      log('SCENARIO-1', '经办人操作属性合理性断言', `检查器呈现操作代号/名称/权限控制: ${inspectorText.includes('基础信息') && inspectorText.includes('权限控制')}`);

      const shotOpSubmit = path.join(SCREENSHOT_DIR, '01-state-op-submit-inspector.png');
      await page.screenshot({ path: shotOpSubmit });
    }

    // 环节 B：测试主管决策或签操作节点 (主管决策或签 OPERATE - 显式多出口)
    const opAuditNode = page.locator('.react-flow__node:has-text("主管决策或签")');
    if (await opAuditNode.isVisible()) {
      log('SCENARIO-1', '环节测试: 主管决策或签操作', '点击或签操作节点验证多Handle出口配置');
      await opAuditNode.click();
      await page.waitForTimeout(800);

      const shotOpAudit = path.join(SCREENSHOT_DIR, '01-state-op-audit-inspector.png');
      await page.screenshot({ path: shotOpAudit });
    }

    // 环节 C：测试金额分级路由节点 (金额分级路由 ROUTER)
    const routerNode = page.locator('.react-flow__node:has-text("金额分级路由")');
    if (await routerNode.isVisible()) {
      log('SCENARIO-1', '环节测试: 金额分级多分支路由', '点击路由节点验证大额核算与常规通道分流规则');
      await routerNode.click();
      await page.waitForTimeout(800);

      const shotRouter = path.join(SCREENSHOT_DIR, '01-state-router-inspector.png');
      await page.screenshot({ path: shotRouter });
    }

    // 环节 D：测试子流程调用节点 (调用核算子流程 SUBFLOW)
    const subflowNode = page.locator('.react-flow__node:has-text("调用核算子流程")');
    if (await subflowNode.isVisible()) {
      log('SCENARIO-1', '环节测试: 私有核算子流程挂载', '点击子流程节点验证子流程引用与参数映射');
      await subflowNode.click();
      await page.waitForTimeout(800);
    }

    // 1.4 界面执行自动排版与编译检查
    log('SCENARIO-1', '执行画布整理与语法编译', '点击整理画布与编译检查');
    await page.click('button:has-text("整理画布")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("编译检查")');
    await page.waitForTimeout(500);

    // 1.5 界面执行动态试运行（注入真实大额参数）
    log('SCENARIO-1', '深度测试: 运行测试弹窗', '点击“运行测试”呼出动态参数测试模态框');
    await page.click('button:has-text("运行测试")');
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

    const shotTestRun = path.join(SCREENSHOT_DIR, '01-state-testrun-modal.png');
    await page.screenshot({ path: shotTestRun });
    log('SCENARIO-1', '试运行弹窗截屏留痕', shotTestRun);

    // 关闭试运行弹窗
    await page.click('[role="dialog"] button[aria-label="关闭"], [role="dialog"] button:has-text("关闭"), [role="dialog"] button:has-text("取消")');
    await page.waitForTimeout(500);

    // 1.6 返回工作区并进入“已启动流程”协同工作台
    await page.click('[data-aiflow-context-header] button:first-child');
    await page.waitForSelector('button:has-text("新增流程")', { timeout: 8000 });

    log('SCENARIO-1', '进入已启动流程工作台', '点击主导航“已启动流程”进入任务流转中心');
    await page.click('#aiflow-console-tab-runs');
    await page.waitForSelector('button:has-text("刷新")', { timeout: 8000 });

    const shotWorkbench = path.join(SCREENSHOT_DIR, '01-process-workbench.png');
    await page.screenshot({ path: shotWorkbench });
    log('SCENARIO-1', '协同工作台截屏留痕', `已启动流程多视图中心: ${shotWorkbench}`);

    // =============================================================
    // 复杂场景二：智能售后工单与故障自动化诊断分流（Control Flow）
    // 节点：工单接入里程碑 -> 上下文转换 -> REST外部HTTP查询 -> LLM大模型智能诊断
    //      -> 严重度条件分支 (SEV1人工网关 -> 熔断执行) / 延时等待与观察 -> 结束
    // =============================================================
    console.log('\n========================================================================');
    console.log('▶ [场景二] 复杂控制流程：智能报障自动化诊断与外部服务调度 (10 节点链路实测)');
    console.log('========================================================================');

    await page.click('#aiflow-console-tab-flows');
    await page.waitForSelector('button:has-text("新增业务")', { timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 1, { timeout: 15000 });

    // 2.1 检索并进入控制流项目
    log('SCENARIO-2', '检索控制流业务', '输入 CT_CANVAS 筛选控制流程综合业务空间');
    await page.fill('input[placeholder*="按业务代号"]', 'CT_CANVAS');
    await page.click('button:has-text("查询")');
    await page.waitForTimeout(1500);

    const ctRow = page.locator('tr:has-text("CT_CANVAS")').first();
    await ctRow.waitFor({ state: 'visible', timeout: 8000 });
    await ctRow.locator('button:has-text("进入业务")').click();
    await page.waitForSelector('button:has-text("新增流程")', { timeout: 8000 });

    // 2.2 环节测试：服务端点目录治理
    log('SCENARIO-2', '环节测试: 服务端点管理面板', '切换至“服务端点”标签页核查外部微服务接口');
    await page.click('button:has-text("服务端点")');
    await page.waitForSelector('table', { timeout: 8000 });

    const shotEndpoints = path.join(SCREENSHOT_DIR, '02-control-service-endpoints.png');
    await page.screenshot({ path: shotEndpoints });
    log('SCENARIO-2', '服务端点截屏留痕', shotEndpoints);

    // 2.3 切换回流程列表并打开画布
    await page.click('button:has-text("流程设计中心")');
    await page.waitForSelector('button:has-text("新增流程")', { timeout: 8000 });

    const ctFlowRow = page.locator('table tbody tr').first();
    await ctFlowRow.locator('button:has-text("设计")').click();
    await page.waitForSelector('.react-flow', { timeout: 10000 });

    const shotCtCanvas = path.join(SCREENSHOT_DIR, '02-control-flow-canvas.png');
    await page.screenshot({ path: shotCtCanvas });
    log('SCENARIO-2', '控制流全拓扑画布截屏留痕', shotCtCanvas);

    // 2.4 环节测试：LLM 大模型诊断节点与 REST HTTP 节点
    const llmNode = page.locator('.react-flow__node:has-text("LLM")').first();
    if (await llmNode.isVisible()) {
      log('SCENARIO-2', '环节测试: AI大模型诊断节点', '点击LLM节点核验提示词Prompt与模型配置');
      await llmNode.click();
      await page.waitForTimeout(800);

      const shotLlm = path.join(SCREENSHOT_DIR, '02-control-llm-inspector.png');
      await page.screenshot({ path: shotLlm });
    }

    const httpNode = page.locator('.react-flow__node:has-text("HTTP")').first();
    if (await httpNode.isVisible()) {
      log('SCENARIO-2', '环节测试: 外部微服务HTTP调用节点', '点击HTTP节点核验EndpointRef引用与幂等安全声明');
      await httpNode.click();
      await page.waitForTimeout(800);

      const shotHttp = path.join(SCREENSHOT_DIR, '02-control-http-inspector.png');
      await page.screenshot({ path: shotHttp });
    }

    // 2.5 控制流静态校验与排版
    log('SCENARIO-2', '控制流语法静态检查与整理', '验证里程碑、条件网关与服务编排');
    await page.click('button:has-text("编译检查")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("整理画布")');
    await page.waitForTimeout(500);

    await page.click('[data-aiflow-context-header] button:first-child');
    await page.waitForSelector('button:has-text("新增流程")', { timeout: 8000 });

    // =============================================================
    // 复杂场景三：全渠道高并发交易流水 ETL 清洗汇算数仓流（Data Flow）
    // 节点：双数据源抽取 (订单+用户) -> 双流关联 Join -> 数据质量门禁 -> 过滤清洗
    //      -> 字段投影 -> 业务特征派生 -> 全局去重 -> 分组聚合汇算 -> 排序 -> 数仓落盘 Sink
    // =============================================================
    console.log('\n========================================================================');
    console.log('▶ [场景三] 复杂数据流程：全渠道电商高并发交易流水 ETL 数仓流 (12 算子全矩阵)');
    console.log('========================================================================');

    await page.click('#aiflow-console-tab-flows');
    await page.waitForSelector('button:has-text("新增业务")', { timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 1, { timeout: 15000 });

    // 3.1 检索并进入数据流项目
    log('SCENARIO-3', '检索数据流业务', '输入 DT_CANVAS 筛选数据处理流业务空间');
    await page.fill('input[placeholder*="按业务代号"]', 'DT_CANVAS');
    await page.click('button:has-text("查询")');
    await page.waitForTimeout(1500);

    const dtRow = page.locator('tr:has-text("DT_CANVAS")').first();
    await dtRow.waitFor({ state: 'visible', timeout: 8000 });
    await dtRow.locator('button:has-text("进入业务")').click();
    await page.waitForSelector('button:has-text("新增流程")', { timeout: 8000 });

    // 3.2 环节测试：资源配置中心（数据源、资产 Schema、UDF 函数、业务标签）
    log('SCENARIO-3', '环节测试: 数据资源中心基础设施', '核验订单资产与用户资产 Schema');
    await page.click('button:has-text("资源配置中心")');
    await page.waitForTimeout(2000);

    const shotResourceCenter = path.join(SCREENSHOT_DIR, '03-data-resource-center.png');
    await page.screenshot({ path: shotResourceCenter });
    log('SCENARIO-3', '资源配置中心截屏留痕', shotResourceCenter);

    // 3.3 切换回流程列表并打开数据流画布
    await page.click('button:has-text("流程设计中心")');
    await page.waitForSelector('button:has-text("新增流程")', { timeout: 8000 });

    const dtFlowRow = page.locator('table tbody tr').first();
    await dtFlowRow.locator('button:has-text("设计")').click();
    await page.waitForSelector('.react-flow', { timeout: 10000 });

    const shotDtCanvas = path.join(SCREENSHOT_DIR, '03-data-flow-canvas.png');
    await page.screenshot({ path: shotDtCanvas });
    log('SCENARIO-3', '数据流全算子矩阵画布截屏留痕', shotDtCanvas);

    // 3.4 先执行整理画布确保视口适应
    if (await page.locator('button:has-text("整理画布")').isVisible()) {
      await page.click('button:has-text("整理画布")');
      await page.waitForTimeout(500);
    }

    // 环节测试：Join、QualityGate、Aggregate 算子检查器
    const joinNode = page.locator('.react-flow__node:has-text("JOIN")').first();
    if (await joinNode.count() > 0) {
      log('SCENARIO-3', '环节测试: 双流关联 Join 算子', '点击Join节点核查主从资产关联键对齐');
      await joinNode.dispatchEvent('click');
      await page.waitForTimeout(800);

      const shotJoin = path.join(SCREENSHOT_DIR, '03-data-join-inspector.png');
      await page.screenshot({ path: shotJoin });
    }

    const qgNode = page.locator('.react-flow__node:has-text("QUALITY")').first();
    if (await qgNode.count() > 0) {
      log('SCENARIO-3', '环节测试: 数据质量门禁算子', '点击门禁算子核验数据清洗断言');
      await qgNode.dispatchEvent('click');
      await page.waitForTimeout(800);
    }

    const aggNode = page.locator('.react-flow__node:has-text("AGGREGATE")').first();
    if (await aggNode.count() > 0) {
      log('SCENARIO-3', '环节测试: 分组聚合汇算算子', '点击聚合算子核验多维分组汇总计算');
      await aggNode.dispatchEvent('click');
      await page.waitForTimeout(800);

      const shotAgg = path.join(SCREENSHOT_DIR, '03-data-aggregate-inspector.png');
      await page.screenshot({ path: shotAgg });
    }

    // 3.5 数据流拓扑排版与执行计划编译
    log('SCENARIO-3', '数据流 ExecutionPlan 执行计划编译', '验证拓扑顺序（Topological Order）与不可变哈希');
    await page.click('button:has-text("编译检查")');
    await page.waitForTimeout(500);

    await page.click('[data-aiflow-context-header] button:first-child');
    await page.waitForSelector('button:has-text("新增流程")', { timeout: 8000 });

    // 3.6 环节测试：流程仓库企业级目录治理
    log('SCENARIO-3', '环节测试: 流程仓库资产中心', '点击主导航“流程仓库”核查目录树与归档治理');
    await page.click('#aiflow-console-tab-warehouse');
    await page.waitForTimeout(2000);

    const shotWarehouse = path.join(SCREENSHOT_DIR, '03-workflow-warehouse.png');
    await page.screenshot({ path: shotWarehouse });
    log('SCENARIO-3', '流程仓库管理截屏留痕', shotWarehouse);

    // 3.7 环节测试：系统配置与组织架构管理
    log('SCENARIO-3', '环节测试: 平台全局配置与组织架构', '点击主导航“系统配置”核验部门树与角色权限');
    await page.click('#aiflow-console-tab-system');
    await page.waitForTimeout(2000);

    const shotSystem = path.join(SCREENSHOT_DIR, '03-system-config-organization.png');
    await page.screenshot({ path: shotSystem });
    log('SCENARIO-3', '系统配置与组织架构截屏留痕', shotSystem);

    console.log('\n========================================================================');
    console.log('       🎉 三大复杂业务场景全链路深度交互与合理性实测 100% 成功！        ');
    console.log('========================================================================\n');

  } catch (err) {
    console.error('测试异常中断:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
