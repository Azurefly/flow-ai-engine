# UI 视觉与丝滑动效重构及线上逐页评审补充实施验收报告 (v3.1 + Addendum)

- 任务编号：UI-00 ~ UI-07 / UIR-001 ~ UIR-014
- 验证日期：2026-09-25
- 实施环境：Windows 11 / Node v20 / pnpm v10.4.1 / React 19 / Vite 7
- 目标规范：
  - `docs/flow-ai-engine-ui-motion-redesign-proposal-2026.md` (基础方案 v3.1)
  - `docs/flow-ai-engine-ui-browser-review-addendum-2026-09-25.md` (线上逐页评审补充方案 v1.0)

---

## 1. 补充实施清单与修改映射（UIR Checklist）

| 编号 / 任务 | 对应修改文件 | 实际实施内容与减负效果 |
| :--- | :--- | :--- |
| **UIR-001** | `client/src/components/ProjectWorkspace.tsx`<br>(`BusinessCenterView`) | 业务中心支持客户端分页控制（默认每页 25 条，可选 50 条），底部增加明确页码与总数指示（“显示第 1~25 项，共 111 个业务项目”）；解决全量平铺导致的无限滚动；新增标准列式 CSV 模板下载；多处去除英文全大写 Eyebrow。 |
| **UIR-002 & UIR-003** | `client/src/components/ProjectWorkspace.tsx`<br>(`ProcessCenter` & `ProjectWorkspace`) | 消除重复的项目名称与“当前业务”介绍卡；流程列表右侧操作列（`th`/`td`）常态粘滞停靠（Sticky Action Dock），行内主次操作分级（发布态以“发起/启动”为主，草稿态以“设计”为主，待审核且有权时突出“通过/驳回”）；保留原有全部 12 列数据与撤销发布等审计字段。 |
| **UIR-004** | `client/src/components/WorkflowDetailPage.tsx`<br>`client/src/components/WorkflowGovernance.tsx` | 流程详情页首屏优化，移除大面积重复卡片；只读画布（`readOnly={true}`）时隐藏顶部添加物料栏与禁用资源按钮，彻底消除不可用按钮堆叠；四步状态条收拢紧凑，替换旧的点状虚线边框。 |
| **UIR-005** | `client/src/components/WorkflowCanvas.tsx` | 未选中节点时，右侧属性检查器（Inspector）彻底隐藏收起，主画布占据 100% 视口空间；选中节点时从右侧展开；节点物料栏在只读模式下隐藏；悬浮动作岛集成撤销/重做/整理/缩放；分类 Tab 增加圆角与平滑选中过渡。 |
| **UIR-006** | `client/src/components/WorkflowTestRunModal.tsx` | 试跑弹窗更新真实性说明：“将保存当前草稿并发起测试执行，实际影响由节点与外部服务配置决定”，纠正纯沙箱仿真误导文案；弹窗扩大至 `max-w-5xl` 并优化为响应式结构；保留抽样分页与表格/JSON双视图。 |
| **UIR-007** | `client/src/components/ProcessWorkbench.tsx` | 待办视图（`view === "todo"`）在未选择任何任务时（`selectedTaskIds.length === 0`）不再展示空置的批量决策下拉框、意见输入框和处理按钮区域，仅在用户多选勾选后才展开批量操作工具栏。 |
| **UIR-008** | `client/src/components/RunCenter.tsx` | 失败告警在 0 记录时由原先宽大醒目的红色面板改为轻量灰底状态行（“当前筛选范围无告警记录 (0 未读)”），告警仅在真实产生时才标红渲染；未选中具体运行记录时，运行列表自适应占满整屏宽度，点击运行记录后才分栏展开详情；英文状态字符串全量映射为中文徽标。 |
| **UIR-009** | `client/src/components/WorkflowWarehouse.tsx` | 流程仓库在未选中条目时收拢右侧 430px 预览栏，由中间流程列表自适应铺满剩余宽度；选中条目后才展开详情与只读流程图，并提供快捷关闭按钮，避免默认空白和三栏滚动嵌套。 |
| **UIR-010** | `client/src/components/SystemConfigShell.tsx` | 系统配置去除生硬的孤立“单项活动卡片页签”凸起，改为与分类导航自然对齐的面包屑轻量标题栏（保留 tested ID 与 ARIA 属性）；表单限定最大宽度（`max-w-4xl`），杜绝极端宽屏拉伸变形。 |

---

## 2. 自动化质量门禁验证记录

| 检查项 | 执行命令 | 结果与退出码 | 关键指标 |
| :--- | :--- | :---: | :--- |
| **类型检查** | `pnpm check` | **退出码 0** | 全量 TypeScript 严格模式 0 错误 |
| **单元回归** | `pnpm test:unit` | **退出码 0** | 37 套件全部通过，251/251 项测试成功（UI 回归约束 100% 保持） |
| **功能回归** | `pnpm test:functional` | **退出码 0** | 7 套件全部通过，44/44 项测试成功 |
| **生产打包** | `pnpm build` | **退出码 0** | 单 Chunk 最大 401.12 KiB（< 450 KiB），总量 1284.47 KiB（< 1300 KiB 预算） |
| **差异空白** | `git diff --check` | **退出码 0** | 无空白污染或语法冲突 |

---

## 3. 回滚方案

若需完全撤回本次所有修改，执行如下标准指令即可：
```bash
git checkout -- client/src/index.css client/src/pages/Home.tsx client/src/components/ProjectWorkspace.tsx client/src/components/WorkflowCanvas.tsx client/src/components/WorkflowDetailPage.tsx client/src/components/WorkflowGovernance.tsx client/src/components/WorkflowTestRunModal.tsx client/src/components/ProcessWorkbench.tsx client/src/components/RunCenter.tsx client/src/components/WorkflowWarehouse.tsx client/src/components/SystemConfigShell.tsx
rm client/src/hooks/useMotionPreference.ts
```
所有修改严格遵守既有业务契约、权限模型与数据接口。
