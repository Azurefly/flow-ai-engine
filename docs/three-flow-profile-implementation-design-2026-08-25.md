# 状态、控制、数据三类流程实施级详细设计报告

日期：2026-08-25
适用仓库：`flow-ai-engine`
适用分支：`main`
审查基线：`47f3db2`
文档状态：实施基线 V1.0
目标读者：产品、架构、后端、前端、测试、数据库、运维与安全负责人

---

## 1. 文档目的

本文用于指导当前流程引擎从“共享画布节点集合 + 两套不完全一致的运行时”改造为三类边界明确、可以独立验证和演进的流程产品：

1. **状态流程（State Flow）**：表达业务对象生命周期、当前状态、当前参与人和可执行操作。
2. **控制流程（Control Flow）**：表达系统动作、外部调用、AI 调用、人工闸门和异常补偿的耐久编排。
3. **数据流程（Data Flow）**：表达带 Schema 的数据集在 Source、Transform、Quality、Sink 之间的 DAG 计算。

本文不是概念建议，而是实施合同。具体覆盖：

- 三类流程的业务定位、使用场景和禁止边界；
- 节点目录、端口类型、配置 Schema 和运行结果；
- 编译器、执行计划、状态机、幂等、Checkpoint 和错误处理；
- 人员解析、部门继承、任务所有权、或签与会签；
- LLM、HTTP、子流程和数据 Connector 的运行约束；
- 数据库增量迁移、旧流程兼容、灰度与回滚；
- tRPC/API、前端设计器、工作台和运行监控改造；
- 单元、MySQL、并发、故障注入、Provider 和浏览器验收；
- 分批 Todo、依赖关系和每批 Definition of Done。

本文不授权立即重构全部运行代码。实施时必须按第 22 节批次推进，每批均独立编译、测试、提交和回滚。

---

## 2. 当前基线与已确认事实

### 2.1 已存在的可靠基础

当前代码已经具备以下可复用能力，不应推倒重写：

- `workflow.flowType` 已区分 `state / control / data`；
- 状态/控制流程发布时可生成不可变执行计划和 SHA-256 哈希；
- `workflow_run_job` 已提供幂等键、租约、Attempt、Checkpoint 和 Worker 领取；
- `workflow_outbox_event` 已提供副作用事件去重、租约和重试；
- 运行状态已有 `queued / running / waiting / blocked / success / failed / cancelled / terminated`；
- 人工任务已有候选人、领取人、任务组、单人、或签、会签、顺序会签和弃权；
- 当前任务操作已经校验运行状态、任务状态、当前处理人和当前操作集合；
- 部门可绑定角色，启用成员可实时继承部门角色权限；
- HTTP 节点已有固定 DNS 结果、私网地址拒绝、超时、响应大小限制和脱敏；
- LLM 节点已有运行时模型目录、结构化输出校验、超时和失败分支；
- 子流程发布时可固化同步快照；
- 数据资源、数据资产、UDF 元数据、数据流运行和计划调度已有项目隔离模型。

### 2.2 当前必须解决的结构性问题

| 编号   | 问题                                                         | 直接影响                                            | 优先级 |
| ------ | ------------------------------------------------------------ | --------------------------------------------------- | ------ |
| FP-001 | 服务端编译器不接收 `flowType`                                | 可通过 API 提交跨类型节点；前端过滤不能作为安全边界 | P0     |
| FP-002 | 状态和控制流程只在画布名称上不同                             | 状态流程可没有状态节点；控制流程可误用业务状态      | P0     |
| FP-003 | 数据画布允许的节点多于 P2 执行器支持范围                     | 流程能设计、能发布但运行时报“尚未启用”              | P0     |
| FP-004 | 数据 SQL 合同使用 `statement`，执行器读取 `sql/query`        | 默认 SQL 节点无法形成闭环                           | P0     |
| FP-005 | 人工任务拒绝直接取消实例                                     | 无法进入已驳回、待修改、补充材料等业务状态          | P0     |
| FP-006 | 表单节点只验证启动输入，不具备独立等待提交语义               | 画布认知与运行语义不一致                            | P1     |
| FP-007 | 数据 Source/Table 主要读取 `sampleJson`                      | 不是生产数据执行                                    | P1     |
| FP-008 | 数据 SQL/UDF 只做计划或元数据校验                            | 没有真实计算和可证明结果                            | P1     |
| FP-009 | 数据多输入隐式拼接                                           | Join 与 Union 语义不可解释                          | P1     |
| FP-010 | 并行、汇聚和循环可编辑但禁止发布                             | 控制编排能力不完整                                  | P1/P2  |
| FP-011 | Timer、Message、Notification、DQ、Join、Aggregate 等节点缺失 | 常见业务只能依赖外部绕行                            | P1     |
| FP-012 | 数据运行未使用与状态/控制一致的计划哈希和耐久 Worker         | 恢复、追溯和同版本证据不足                          | P1     |

### 2.3 现有运行能力分级

实施期间必须继续公开能力分级，不得把“代码存在”展示为“生产可用”：

| 能力              | 当前分级         | 升级为 production 前的必要条件                       |
| ----------------- | ---------------- | ---------------------------------------------------- |
| 状态/控制耐久运行 | beta             | 真实 MySQL 故障注入、租约恢复、重复副作用验证        |
| 人工审批与会签    | beta             | 多身份 MySQL 并发投票和浏览器闭环                    |
| LLM 节点          | beta 或 disabled | 真实 Provider、Schema、超时、费用和失败分支 E2E      |
| 数据流程          | experimental     | 真实 Connector、Schema、Checkpoint、血缘和 Sink 验收 |

---

## 3. 总体架构决策

### 3.1 决策结论

采用以下增量架构：

```text
流程设计器
   │
   ▼
WorkflowDefinition（编辑态）
   │
   ▼
FlowProfileRegistry
   ├── StateProfileCompiler
   ├── ControlProfileCompiler
   └── DataProfileCompiler
   │
   ▼
Immutable Execution Plan + Plan Hash
   │
   ├── state/control ──► Workflow Worker ──► Task/Timer/Outbox
   │
   └── data ──────────► Dataflow Worker ──► Dataset/Checkpoint/Lineage
```

原则如下：

1. 三类流程共用身份、项目、版本、发布、审计和诊断框架。
2. 状态和控制流程可以共用耐久 Worker 基础设施，但必须使用不同 Profile 语义校验。
3. 数据流程使用独立 Dataset Runtime，不能把行集伪装成普通 JSON 上下文交给状态/控制执行器。
4. `workflow.flowType` 是权威类型，创建后不可直接修改。
5. 编辑态允许保存部分配置，但发布态必须通过对应 Profile 的完整编译。
6. 未实现运行语义的节点必须在发布时阻断，前端同时显示能力状态。
7. 已发布执行计划不可变；新实现不能修改正在运行实例的快照。

### 3.2 不采用的方案

- 不创建三套完全独立的流程 CRUD 和版本表，避免治理重复。
- 不让前端节点过滤承担安全边界。
- 不让数据流程继续调用通用 `executeNode()` 逐步扩展，因为普通 JSON 与 Dataset 生命周期不同。
- 不在定义中保存数据库密码、API Token 或 LLM Key。
- 不直接执行迁移定义中的任意 JavaScript、Java 或 SQL 脚本。
- 不通过修改旧发布计划修复历史实例。

---

## 4. 核心类型与编译合同

### 4.1 Profile 定义

新增 `shared/flow-profile-contract.ts`，核心接口建议如下：

```ts
export type FlowType = "state" | "control" | "data";

export type RuntimeKind = "workflow" | "dataflow";

export type PortType =
  | "control"
  | "context"
  | "task_result"
  | "event"
  | "dataset"
  | "metrics";

export type FlowProfile = {
  type: FlowType;
  version: number;
  runtimeKind: RuntimeKind;
  allowedNodeTypes: ReadonlySet<FlowNodeType>;
  requiredCapabilities: string[];
  createDefaultDefinition(): WorkflowDefinition;
  validateSemantics(input: ProfileValidationInput): WorkflowCompileDiagnostic[];
};
```

注册表必须是前后端共享的只读合同：

```ts
export const FLOW_PROFILES: Record<FlowType, FlowProfileDefinition> = {
  state: STATE_FLOW_PROFILE,
  control: CONTROL_FLOW_PROFILE,
  data: DATA_FLOW_PROFILE,
};
```

运行函数由服务端实现，不放入共享包。

### 4.2 节点定义 V2

扩展现有 `FlowNodeDefinition`：

```ts
export type FlowNodeDefinition = {
  type: FlowNodeType;
  label: string;
  description: string;
  category: string;
  flowTypes: FlowType[];
  runtimeKinds: RuntimeKind[];
  maturity: "production" | "beta" | "experimental" | "disabled";
  inputPorts: NodePortDefinition[];
  outputPorts: NodePortDefinition[];
  sideEffect: "none" | "read" | "write" | "external" | "human_wait";
  defaultConfig: NodeConfig;
  fields: NodeField[];
};
```

`flowTypes` 只用于目录展示，发布安全由服务端 Profile 校验。

### 4.3 编译器 API 改造

现有：

```ts
compileWorkflowDefinition(definition);
analyzeWorkflowDefinition(definition, { executable });
```

目标：

```ts
type WorkflowCompileOptions = {
  flowType: FlowType;
  executable: boolean;
  availableCapabilities?: ReadonlySet<string>;
  source: "draft" | "publish" | "rollback" | "subflow";
};

analyzeWorkflowDefinition(definition, options);
compileWorkflowDefinition(definition, options);
validateWorkflowDefinition(definition, options);
```

所有调用点必须显式传入 `flowType`，不得提供默认值。

### 4.4 执行计划 V2

```ts
export type WorkflowExecutionPlanV2 = {
  schemaVersion: 2;
  compilerVersion: "2.0.0";
  profile: {
    flowType: FlowType;
    profileVersion: number;
    runtimeKind: RuntimeKind;
  };
  definition: WorkflowDefinition;
  entryNodeId: string;
  terminalNodeIds: string[];
  nodes: Record<string, CompiledNodePlan>;
  outgoing: Record<string, CompiledEdgePlan[]>;
  incoming: Record<string, CompiledEdgePlan[]>;
  requiredCapabilities: string[];
  topologicalOrder: string[] | null;
  parallelGroups: ParallelGroupPlan[];
  loops: LoopPlan[];
};
```

计划哈希必须覆盖：

- `flowType`；
- Profile 版本；
- 节点规范化配置；
- 端口和连线；
- 子流程快照及其哈希；
- 运行能力要求；
- 并行、循环、重试、超时和结果路由策略。

### 4.5 新增稳定诊断码

| 诊断码                             | 含义                            |
| ---------------------------------- | ------------------------------- |
| `WF_PROFILE_NODE_FORBIDDEN`        | 节点不属于当前流程类型          |
| `WF_PROFILE_EDGE_FORBIDDEN`        | 两节点端口或 Profile 不允许连接 |
| `WF_PROFILE_CAPABILITY_DISABLED`   | 发布依赖的运行能力未启用        |
| `WF_PROFILE_RUNTIME_MISMATCH`      | 流程类型与运行入口不匹配        |
| `ST_STATE_REQUIRED`                | 状态流程没有业务状态节点        |
| `ST_INITIAL_STATE_INVALID`         | 开始后无法确定唯一初始状态      |
| `ST_OPERATION_STATE_UNBOUND`       | 人工操作不属于明确状态迁移      |
| `ST_OUTCOME_ROUTE_REQUIRED`        | 操作结果缺少目标分支            |
| `ST_TERMINAL_STATE_REQUIRED`       | 结束前不存在终态                |
| `CTRL_SIDE_EFFECT_POLICY_REQUIRED` | 写操作缺少幂等或补偿策略        |
| `CTRL_WAIT_POLICY_INVALID`         | 等待/定时配置无效               |
| `DATA_DATASET_PORT_REQUIRED`       | 数据节点缺少 Dataset 输入或输出 |
| `DATA_SCHEMA_INCOMPATIBLE`         | 上下游 Schema 不兼容            |
| `DATA_JOIN_KEYS_REQUIRED`          | Join 未配置连接键               |
| `DATA_SINK_POLICY_REQUIRED`        | Sink 未配置写入和幂等策略       |
| `DATA_NODE_RUNTIME_UNSUPPORTED`    | 数据执行器尚不支持该节点        |

---

## 5. 三类流程节点白名单

### 5.1 第一阶段发布白名单

第一阶段只开放当前可以形成闭环的节点；目标节点完成运行实现后再升级白名单。

| 节点        | 状态     | 控制                 | 数据                       | 第一阶段处理                             |
| ----------- | -------- | -------------------- | -------------------------- | ---------------------------------------- |
| `start`     | 允许     | 允许                 | 允许                       | 保留                                     |
| `end`       | 允许     | 允许                 | 允许                       | 保留                                     |
| `state`     | 必需     | 禁止                 | 禁止                       | 控制流程旧定义只读兼容，重新发布前迁移   |
| `operate`   | 允许     | 允许，显示为人工闸门 | 禁止                       | 增加结果出口                             |
| `form`      | 条件允许 | 条件允许             | 禁止                       | 先限定为启动输入校验；后续附着到任务     |
| `router`    | 允许     | 允许                 | 禁止                       | 广播继续阻断发布                         |
| `condition` | 允许     | 允许                 | 暂时禁止                   | 数据质量网关完成后再开放                 |
| `transform` | 允许     | 允许                 | 暂时仅允许安全数据映射子集 | 分离 JSON 与 Dataset 配置                |
| `rest`      | 允许     | 允许                 | 禁止                       | 迁移为 ServiceTask 兼容类型              |
| `method`    | 允许     | 允许                 | 禁止                       | 迁移为 ServiceTask 兼容类型              |
| `http`      | 允许     | 允许                 | 禁止                       | 迁移为 ServiceTask 兼容类型              |
| `llm`       | 允许     | 允许                 | 禁止                       | Provider 未就绪时阻断发布或显式 disabled |
| `subflow`   | 允许     | 允许                 | 暂时禁止                   | 数据子流程另建合同                       |
| `source`    | 禁止     | 禁止                 | 允许                       | 第一阶段仍标 experimental                |
| `table`     | 禁止     | 禁止                 | 允许                       | 第一阶段仍标 experimental                |
| `sql`       | 禁止     | 禁止                 | 修复字段后允许只读计划     | UI 明示“计划验证”，不宣称执行            |
| `filter`    | 禁止     | 禁止                 | 允许                       | 仅等值筛选时显示能力说明                 |
| `map`       | 禁止     | 禁止                 | 允许                       | 保留选列和 limit                         |
| `edit_sql`  | 禁止     | 禁止                 | 合并迁移到 `sql`           | 新建流程不再添加别名节点                 |
| `udf`       | 禁止     | 禁止                 | 仅元数据验证               | 未有 Sandbox 前不可标 production         |
| `sink`      | 禁止     | 禁止                 | 允许审计输出               | 真实写入 Connector 完成后扩展            |
| `output`    | 禁止     | 禁止                 | 兼容                       | 新建流程统一使用 `sink`                  |

### 5.2 目标新增节点

```text
状态：timer、message_catch、notification
控制：trigger、wait、message_catch、fork、join、compensation、notification
数据：schema_assert、derive、join、union、aggregate、sort、deduplicate、quality_gate、checkpoint
跨流程：call_control_flow、start_data_job、send_state_command
```

每个新增节点必须满足以下条件后才能加入发布白名单：

1. 共享合同和配置校验已实现；
2. 服务端执行器已实现；
3. 节点运行审计已实现；
4. 重试、取消、超时语义已实现；
5. 单元和真实依赖集成测试通过；
6. 前端能力状态与后端同源。

---

## 6. 状态流程详细设计

### 6.1 业务语义

状态流程的权威问题是：

- 当前业务对象处于什么状态；
- 哪些人以什么角色参与；
- 当前有哪些操作可执行；
- 哪次操作导致了哪次状态迁移；
- 谁代表谁做了操作；
- 状态迁移前后数据和权限是什么。

状态流程不得只依靠任务表推断当前状态。需要独立保存运行实例的当前业务状态和迁移历史。

### 6.2 状态流程结构规则

发布时必须满足：

1. 一个 `start`、一个物理 `end`；
2. 至少一个 `state`；
3. 从 `start` 可确定唯一初始状态；
4. 每个非终态至少有一个合法操作或系统迁移；
5. 每个 `operate` 必须从明确状态可达，并配置结果出口；
6. `approved / rejected / returned` 等已声明结果必须各自连接目标；
7. 业务终态必须进入 `end`；
8. 未实现循环前，不允许“退回到前一状态”的循环发布；
9. 状态代号在流程内唯一；
10. 操作代号在所属状态内唯一；
11. 状态流程禁止数据 Source、SQL、UDF、Sink 节点；
12. LLM 不得直接作为业务终态的唯一决定依据，除非有确定性校验或人工复核。

### 6.3 状态节点合同

目标配置：

```ts
type StateNodeConfigV2 = {
  stateCode: string;
  displayName: string;
  stateType: "business" | "system" | "terminal";
  color?: string;
  flowStatus?: string;
  participantRoles?: string[];
  visibleTo?: AuthorizationSelector[];
  businessOperations?: Array<{
    operationCode: string;
    displayName: string;
  }>;
  terminalResult?: "success" | "rejected" | "cancelled" | "custom";
};
```

兼容映射：

| 旧字段       | V2 字段              |
| ------------ | -------------------- |
| `nodeDh`     | `stateCode`          |
| `jdmc`       | `displayName`        |
| `bdjs`       | `participantRoles`   |
| `ywcz`       | `businessOperations` |
| `stateColor` | `color`              |
| `flowStatus` | `flowStatus`         |

进入状态时必须在一个事务中：

1. 对 `workflow_run.stateVersion` 做 CAS 更新；
2. 更新 `currentStateCode/currentStateNodeId`；
3. 插入 `workflow_state_transition`；
4. 更新参与人状态；
5. 计算该状态下允许创建的操作任务；
6. 写入 Outbox 状态变化事件；
7. 保存 Checkpoint。

### 6.4 人工操作节点合同

目标配置：

```ts
type OperateNodeConfigV2 = {
  operationCode: string;
  displayName: string;
  instruction: string;
  assignee: ParticipantSelector;
  emptyAssigneePolicy: "fail" | "initiator" | "workflow_owner" | "admin_queue";
  signPolicy: {
    mode: "single" | "or" | "and" | "sequential";
    passBasisPoints?: number;
    rejectionPolicy: "threshold_impossible" | "any_reject" | "collect_all";
    allowAbstain: boolean;
  };
  form?: {
    schemaId?: string;
    inlineSchema?: FormSchema;
    schemaVersion: number;
  };
  outcomes: Array<{
    code: "approved" | "rejected" | "returned" | "cancelled" | string;
    label: string;
    requireComment?: boolean;
    sourceHandle: string;
  }>;
  sla?: {
    dueAfterSeconds: number;
    reminderAfterSeconds?: number;
    escalationAfterSeconds?: number;
  };
  delegation?: {
    allowTransfer: boolean;
    allowDelegate: boolean;
    allowAddApprover: boolean;
    allowRemoveApprover: boolean;
  };
};
```

操作节点输出：

```ts
type OperateResult = {
  taskId: string;
  groupId?: string;
  operationCode: string;
  outcome: string;
  decision: "approved" | "rejected" | "abstained" | "returned";
  comment?: string;
  formData?: Record<string, unknown>;
  actorUserId: number;
  responsibleUserId: number;
  representedUserId?: number;
  delegationId?: string;
  decidedAt: string;
};
```

运行路由使用任务组最终结果，而不是最后一张个人票：

- 单人：个人结果即组结果；
- 或签：第一张有效通过票产生 `approved`；达到拒绝策略时产生 `rejected`；
- 会签：达到阈值产生 `approved`，剩余票不可能达到阈值时产生 `rejected`；
- 顺序会签：只激活当前顺序，最终按阈值或策略产生组结果；
- 弃权：只增加 decided 数量，不增加 approved/rejected；
- `returned` 是流程动作，不是会签投票；会签组使用退回时应由策略明确“立即退回”或“禁止”。

### 6.5 参与人解析合同

```ts
type ParticipantSelector =
  | { kind: "user"; userIds: number[] }
  | { kind: "role"; roleCode: string; scope: "system" | "workflow" }
  | { kind: "department"; unitIds: string[]; includeDescendants: boolean }
  | { kind: "department_manager"; unitSource: "initiator" | "actor" | "form" }
  | { kind: "initiator" }
  | { kind: "manager"; subject: "initiator" | "actor"; level: number }
  | { kind: "previous_receivers" }
  | { kind: "form_user"; field: string }
  | { kind: "expression"; expressionId: string };
```

解析返回必须可解释：

```ts
type ParticipantResolution = {
  selector: ParticipantSelector;
  resolvedAt: string;
  candidateUserIds: number[];
  excluded: Array<{ userId?: number; reason: string }>;
  organizationVersion?: string;
  fallbackApplied?: string;
};
```

部门权限采用实时继承；任务候选人采用创建时快照。组织变更不自动改写已创建会签组。

### 6.6 状态迁移事务

完成任务并迁移状态必须使用单事务命令：

```text
锁定 workflow_task
  → 校验 claimedByUserId、账号状态、任务版本
  → 锁定 workflow_task_group
  → 写个人决定
  → 计算组结果
  → 若仍等待：激活下一任务并提交
  → 若组完成：关闭剩余任务
  → 写 OperateResult
  → 根据 outcomeHandle 解析唯一后继
  → 更新 workflow_run 当前状态版本
  → 写 workflow_state_transition
  → 写 resume job（唯一幂等键）
  → 提交事务
```

任何一步失败必须整体回滚。不得先完成任务、后异步决定下一状态而没有恢复记录。

### 6.7 状态流程示例

```text
start
  → SUBMITTED（已提交）
  → MANAGER_APPROVAL（直属主管审批）
      approved → FINANCE_REVIEW（财务复核）
      rejected → REJECTED（已驳回）
      returned → NEED_CHANGES（待修改）
  → APPROVED（已批准）
  → end
```

第一阶段循环仍禁用，因此 `NEED_CHANGES → MANAGER_APPROVAL` 只能在循环运行实现后开放；在此之前终止当前实例并提供“基于原实例重新发起”。

---

## 7. 控制流程详细设计

### 7.1 业务语义

控制流程回答“下一步执行什么”，不承担业务对象长期状态的唯一事实源。典型场景：

- API 编排与系统集成；
- 订单创建后同步库存、支付、通知；
- 文件到达后解析、调用模型、写回结果；
- 异常自动重试后转人工闸门；
- 定时触发和等待外部回调；
- 可补偿的 Saga 编排。

### 7.2 控制流程结构规则

1. 一个开始节点和一个物理结束节点；
2. 不允许业务 `state` 节点，新定义改用 `milestone/checkpoint`；
3. 每个外部写操作必须声明幂等策略或补偿策略；
4. 每个 LLM 节点必须有失败处理策略；
5. 等待节点必须有超时策略；
6. 事件等待必须有相关键和重复事件处理策略；
7. 并行分支必须有明确 Join；
8. 循环必须设置最大次数和退出分支；
9. 人工闸门必须绑定明确候选人；
10. 控制流程禁止 Source、Table、SQL、UDF、Sink 等数据集节点。

### 7.3 触发节点

目标配置：

```ts
type TriggerConfig =
  | { kind: "manual"; inputSchema?: JsonSchema }
  | { kind: "api"; inputSchema: JsonSchema; idempotencyHeader: string }
  | {
      kind: "schedule";
      cron: string;
      timezone: string;
      misfirePolicy: "skip" | "fire_once";
    }
  | { kind: "event"; eventType: string; correlationPath: string };
```

第一阶段保留 `start`，把触发配置放入流程设置；后续再将触发器产品化为节点或入口配置。

### 7.4 服务任务

将 `rest / method / http` 收敛为统一运行类型 `service_task`，旧类型在编译时转换为兼容节点计划。

```ts
type ServiceTaskConfig = {
  adapter: "http" | "internal_method";
  endpointRef?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, TemplateValue>;
  query?: Record<string, TemplateValue>;
  body?: unknown;
  timeoutMs: number;
  responseLimitBytes: number;
  credentialRef?: string;
  retry: {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    retryOn: Array<"timeout" | "network" | "429" | "5xx">;
  };
  idempotency: {
    mode: "none" | "runtime_header" | "provider_key";
    headerName?: string;
  };
  compensation?: {
    nodeId: string;
    required: boolean;
  };
};
```

约束：

- GET 默认可重试；
- POST/PUT/PATCH/DELETE 未配置幂等或补偿时禁止生产发布；
- 凭据只能通过 `credentialRef` 注入；
- URL 模板不能控制协议、主机和端口，推荐使用受管 Endpoint；
- 保存请求和响应摘要，不保存 Authorization/Cookie/Secret；
- 节点输出必须包含 status、headers 摘要、body、duration、attempt 和 requestId。

### 7.5 条件与路由

- `condition`：仅 true/false；
- `router`：多分支、优先级、默认分支；
- 旧任意代码条件继续保存但禁止执行；
- 同一控制令牌在非广播路由中只能选择一个分支；
- 广播路由必须由 Fork/Join 运行时处理，不能复用当前队列多入边逻辑。

### 7.6 LLM 节点

目标配置在现有模型、Prompt、Token、超时、Schema、失败分支基础上增加：

```ts
type LlmGovernance = {
  providerRef?: string;
  maxCostMicros?: number;
  dataClassification: "public" | "internal" | "confidential";
  allowSensitiveFields: string[];
  cachePolicy: "none" | "prompt_hash";
  deterministicValidation?: {
    schema: JsonSchema;
    allowedValues?: Record<string, unknown[]>;
  };
  humanReviewRequired: boolean;
};
```

规则：

- Provider 未配置且 LLM 是必经节点时禁止发布；
- 模型必须来自运行时白名单；
- 结构化输出由服务端二次校验；
- 关键状态或资金决定必须进入确定性规则或人工闸门；
- Prompt、模型、Token usage、finishReason、耗时和 requestId 可审计；
- 凭据和敏感上下文不进入节点运行明文日志。

### 7.7 Wait、Timer 与 Event

新增持久化表 `workflow_timer` 和 `workflow_event_subscription`。

```ts
type WaitConfig =
  | { kind: "duration"; durationSeconds: number }
  | { kind: "until"; timestampTemplate: string };

type MessageCatchConfig = {
  eventType: string;
  correlationKeyTemplate: string;
  expiresAfterSeconds?: number;
  timeoutHandle?: string;
  duplicatePolicy: "ignore" | "audit";
};
```

Timer 到期只能通过唯一幂等键创建一次 resume job。服务重启后扫描过期 Timer 补触发。

### 7.8 并行、汇聚和循环

新增持久化令牌模型后再开放：

```text
workflow_execution_token
workflow_node_instance
workflow_join_state
```

Fork 为每条分支生成独立 token；Join 按 `all / any / n_of_m` 聚合。循环边保存迭代次数，超过上限进入失败或超限分支。

当前 `executeRunSegment()` 使用单个队列和本段 `executed Set`，不能作为可靠并行和重复到达模型，禁止只移除发布拦截来“启用”并行或循环。

### 7.9 补偿

每个成功的外部副作用节点写入补偿栈：

```ts
type CompensationRecord = {
  runId: string;
  nodeRunId: string;
  compensationNodeId: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  idempotencyKey: string;
};
```

终止与失败是否执行补偿由流程设置决定。取消、终止和业务拒绝不能共用一个模糊状态。

### 7.10 控制流程示例

```text
API Trigger
  → Validate Input
  → Create Order（HTTP，幂等）
  → LLM Risk Classifier
  → Condition
      low-risk  → Capture Payment
      high-risk → Human Gate
  → Notify
  → End

失败：Create Order 已成功但 Payment 失败
  → Compensation: Cancel Order
```

---

## 8. 数据流程详细设计

### 8.1 业务语义

数据流程边上传递的是 Dataset，不是普通 JSON。Dataset 由以下信息组成：

```ts
type DatasetDescriptor = {
  artifactId: string;
  schema: DatasetSchema;
  schemaHash: string;
  storageRef: string;
  format: "rows" | "jsonl" | "csv" | "parquet" | "table";
  partition?: Record<string, string>;
  rowCount?: number;
  byteCount?: number;
  watermark?: string;
  lineageNodeRunId: string;
  sampleRef?: string;
};
```

节点间不得直接把全部生产数据写入 `outputJson`。数据库只保存描述符、统计、受限样本引用和血缘。

### 8.2 数据流程结构规则

1. 一个开始节点和一个结束节点；
2. 至少一个 Source 或 SQL Source；
3. 至少一个 Sink/Output；
4. 所有处理节点必须有 Dataset 输入；
5. 所有连线必须通过 Schema 兼容校验；
6. 多输入必须明确选择 Join 或 Union，禁止隐式拼接；
7. Join 必须配置键、连接类型和空值策略；
8. Sink 必须配置写入模式、主键和幂等策略；
9. SQL 必须引用项目内已验证数据源；
10. UDF 必须已审核、Artifact 可用且 Sandbox 能力启用；
11. 数据流程禁止状态、人工任务、通用 Router、通用 LLM；
12. 需要人工介入时，通过事件启动状态流程；
13. 循环 DAG 禁止发布；
14. 每个运行保存计划哈希、输入水位、Checkpoint 和输出资产。

### 8.3 Source 节点

```ts
type SourceConfig = {
  sourceId: string;
  assetId: string;
  readMode: "snapshot" | "incremental";
  columns?: string[];
  predicate?: SafePredicate;
  limit?: number;
  incremental?: {
    cursorColumn: string;
    initialValue?: string;
    lagSeconds?: number;
  };
};
```

第一批真实 Connector 只实现：

1. `inline`：用于测试和小样本；
2. `jdbc/mysql`：参数化只读查询和表扫描。

API、文件、对象存储和其他 JDBC 方言在 Connector SPI 稳定后添加。

### 8.4 Connector SPI

新增 `server/dataflow/connectors/types.ts`：

```ts
interface DataConnector {
  readonly type: string;
  testConnection(input: ConnectorContext): Promise<ConnectionTestEvidence>;
  discover(input: ConnectorContext): Promise<DiscoveredAsset[]>;
  read(input: ReadRequest): AsyncIterable<DatasetBatch>;
  write?(input: WriteRequest): Promise<WriteResult>;
}
```

连接配置、凭据和运行授权分别处理：

- `connectionJson`：不敏感的主机、端口、数据库、选项；
- `credentialRef`：Secret Manager 引用；
- 运行时：使用项目和数据源权限校验后解析 Secret；
- 节点输出和日志不返回凭据。

### 8.5 SQL节点

统一字段：

```ts
type SqlNodeConfigV2 = {
  datasourceId: string;
  statement: string;
  parameters: Record<string, TemplateValue>;
  expectedSchema?: DatasetSchema;
  maxRows?: number;
  timeoutMs?: number;
};
```

实施要求：

- 兼容读取旧 `sql/query`，保存时规范化为 `statement`；
- 禁止多语句、DDL、DML、权限语句和文件操作；
- 不再只依赖正则判断，需要方言感知的 SQL Parser 或受限 Query Builder；
- 使用参数绑定，不拼接用户值；
- 数据库账号保持只读权限；
- 发布时解析 SQL 并生成列级依赖；
- 运行时保存实际行数、耗时和查询摘要；
- 不在审计中保存敏感参数明文。

### 8.6 Filter、Project、Derive

拆分当前混合行为：

```ts
type FilterConfig = { predicate: SafePredicate };
type ProjectConfig = {
  columns: Array<{ source: string; target?: string; cast?: DataType }>;
};
type DeriveConfig = {
  fields: Array<{ name: string; expression: SafeExpression; type: DataType }>;
};
```

`transform.mappings` 继续用于 JSON 上下文；数据流程使用 `derive/project`，避免同一配置在两套运行时下含义不同。

### 8.7 Join 与 Union

```ts
type JoinConfig = {
  kind: "inner" | "left" | "right" | "full";
  leftKeys: string[];
  rightKeys: string[];
  nullEqualsNull: boolean;
  collisionPolicy: "prefix" | "error";
  leftPrefix?: string;
  rightPrefix?: string;
};

type UnionConfig = {
  mode: "all" | "distinct";
  alignBy: "name" | "position";
  missingColumnPolicy: "null" | "error";
};
```

连接端口必须区分 `left/right`。不能继续将所有父节点 `rows.flatMap()` 作为隐式 Union。

### 8.8 Aggregate、Sort、Deduplicate

```ts
type AggregateConfig = {
  groupBy: string[];
  metrics: Array<{
    output: string;
    fn: "count" | "sum" | "avg" | "min" | "max";
    field?: string;
  }>;
};

type SortConfig = {
  fields: Array<{ field: string; direction: "asc" | "desc" }>;
  limit?: number;
};

type DeduplicateConfig = {
  keys: string[];
  keep: "first" | "last";
  orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;
};
```

### 8.9 UDF

UDF 不能从“元数据存在”直接升级为执行。必须先实现：

- Artifact 完整性哈希；
- 审核人、审核版本和有效期；
- 资源上限、超时、网络隔离、文件系统隔离；
- 输入输出 Schema；
- 版本固定；
- 日志、错误和敏感数据脱敏；
- Sandbox 不可用时发布阻断。

第一阶段保留 `metadata_safe` 结果，但 UI 明确显示“仅验证引用，不执行函数”。

### 8.10 数据质量节点

```ts
type QualityGateConfig = {
  checks: Array<
    | { type: "not_null"; field: string; maxFailureRate: number }
    | { type: "unique"; fields: string[]; maxDuplicates: number }
    | { type: "range"; field: string; min?: number; max?: number }
    | { type: "regex"; field: string; pattern: string }
    | { type: "row_count"; min?: number; max?: number }
  >;
  onFailure: "fail" | "quarantine" | "route";
  failureHandle?: string;
};
```

输出包含通过状态、失败条数、失败比例、受限样本引用和规则版本。质量失败需要人工处理时写 Outbox 事件，由状态流程接管。

### 8.11 Sink节点

```ts
type SinkConfig = {
  connectorId: string;
  targetAsset: string;
  mode: "append" | "overwrite_partition" | "upsert";
  keys?: string[];
  partition?: Record<string, TemplateValue>;
  schemaPolicy: "strict" | "additive";
  idempotency: {
    keyTemplate: string;
    duplicatePolicy: "skip" | "replace" | "fail";
  };
};
```

`overwrite` 全表覆盖默认禁止。高风险 Sink 需要发布权限和数据写入权限同时满足。

### 8.12 数据运行算法

数据运行采用拓扑调度和耐久节点作业：

```text
创建 dataflow_run
  → 固化执行计划和输入水位
  → 创建根 dataflow_run_job
  → 领取可运行节点
  → 读取父 DatasetDescriptor
  → 执行节点并生成新 Artifact
  → 原子写 node_run + artifact + lineage + checkpoint
  → 激活后继节点
  → 所有终点成功后提交水位并结束
```

失败时不得提交增量水位。重试必须复用相同节点幂等键；Sink 重试必须能识别已经提交的批次。

### 8.13 数据流程示例

```text
Schedule Start
  → Orders Source
  → Schema Assert
  → Filter(status = PAID)
  → Join Customer(left.customer_id = right.id)
  → Aggregate(region, sum(amount))
  → Quality Gate
      success → MySQL Upsert Sink
      failure → Quarantine Sink + Outbox Event
  → End
```

---

## 9. 跨流程调用设计

三类流程之间只能通过显式节点调用，禁止任意节点混接。

### 9.1 `call_control_flow`

状态流程调用控制流程完成系统动作。

```ts
type CallControlFlowConfig = {
  workflowId: string;
  versionPolicy: "published_snapshot";
  inputMapping: Record<string, TemplateValue>;
  mode: "sync" | "async";
  timeoutSeconds?: number;
  successHandle: string;
  failureHandle: string;
};
```

### 9.2 `start_data_job`

状态/控制流程启动数据流程。

```ts
type StartDataJobConfig = {
  workflowId: string;
  inputMapping: Record<string, TemplateValue>;
  mode: "wait" | "fire_and_forget";
  timeoutSeconds?: number;
  successHandle?: string;
  failureHandle?: string;
};
```

### 9.3 `send_state_command`

控制流程向既有状态实例发送命令。

```ts
type SendStateCommandConfig = {
  targetWorkflowId: string;
  businessKeyTemplate: string;
  operationCode: string;
  payloadMapping: Record<string, TemplateValue>;
  authorizationMode: "service_identity" | "original_actor";
};
```

命令仍必须经过目标状态流程的当前状态、当前操作和主体权限校验，不能作为后台绕过入口。

---

## 10. 数据库增量设计

### 10.1 修改现有表

#### `workflow_run`

新增：

| 字段                 | 类型          | 用途                                          |
| -------------------- | ------------- | --------------------------------------------- |
| `flowType`           | enum          | 固化运行类型，避免运行期依赖可变流程记录      |
| `businessKey`        | varchar(160)  | 状态实例业务主键；控制流程可空                |
| `currentStateCode`   | varchar(160)  | 状态流程当前状态                              |
| `currentStateNodeId` | varchar(160)  | 当前状态来源节点                              |
| `stateVersion`       | int default 0 | 乐观并发控制                                  |
| `endReason`          | varchar(96)   | approved/rejected/cancelled/failed 等明确原因 |

索引：

```text
UNIQUE(workflowId, businessKey) WHERE businessKey IS NOT NULL
INDEX(workflowId, currentStateCode, status)
```

MySQL 无部分索引时，是否允许同业务键多实例必须通过业务规则和事务查询保证；如果要求唯一，可增加单独状态实例表。

#### `workflow_task`

新增：

| 字段                      | 用途                        |
| ------------------------- | --------------------------- |
| `operationCode`           | 稳定业务操作代号            |
| `ownerVersion`            | 领取、转办、改派的 CAS 版本 |
| `participantSnapshotJson` | 候选人解析证据              |
| `outcomeHandlesJson`      | 结果到 Source Handle 的映射 |
| `formSchemaVersion`       | 表单版本                    |
| `dueAt`                   | SLA 到期时间                |
| `responsibleUserId`       | 责任主体                    |
| `representedUserId`       | 被代理主体                  |
| `delegationId`            | 代理关系引用                |

#### `workflow_task_group`

新增：

| 字段              | 用途                                        |
| ----------------- | ------------------------------------------- |
| `rejectionPolicy` | any_reject/threshold_impossible/collect_all |
| `allowAbstain`    | 是否允许弃权                                |
| `groupOutcome`    | approved/rejected/returned                  |
| `memberVersion`   | 加签减签并发控制                            |

#### `dataflow_run`

新增：

| 字段                  | 用途               |
| --------------------- | ------------------ |
| `executionPlanJson`   | 不可变数据执行计划 |
| `executionPlanHash`   | 计划哈希           |
| `checkpointJson`      | 作业恢复点         |
| `requestId`           | 链路追踪           |
| `watermarkInputJson`  | 本次读取水位       |
| `watermarkOutputJson` | 成功后提交水位     |

### 10.2 新增状态/控制表

#### `workflow_state_transition`

```text
id, runId, workflowId, sequenceNo,
fromStateCode, toStateCode, transitionCode,
taskId, actorUserId, responsibleUserId, representedUserId,
payloadJson, resultJson, requestId, createdAt
```

约束：`UNIQUE(runId, sequenceNo)`。

#### `workflow_timer`

```text
id, runId, nodeId, timerType, dueAt, status,
resumeHandle, idempotencyKey, firedAt, cancelledAt, requestId
```

约束：`UNIQUE(idempotencyKey)`；领取索引 `(status, dueAt)`。

#### `workflow_event_subscription`

```text
id, runId, nodeId, eventType, correlationKey,
status, expiresAt, timeoutHandle, consumedEventId, createdAt
```

约束：`UNIQUE(eventType, correlationKey, runId, nodeId)`。

#### 并行运行后续表

```text
workflow_execution_token
workflow_node_instance
workflow_join_state
workflow_compensation_record
```

这些表只在并行批次引入，不与 P0 Profile 防线同时上线。

### 10.3 新增数据运行表

#### `dataflow_run_job`

字段与现有 `workflow_run_job` 保持相似，但 FK 指向 `dataflow_run`，并增加 `nodeId`、`partitionKey`。

#### `dataflow_node_run`

```text
id, runId, nodeId, nodeType, sequenceNo, attempt,
status, inputArtifactsJson, outputArtifactsJson,
metricsJson, errorJson, requestId, startedAt, finishedAt
```

#### `dataflow_dataset_artifact`

```text
id, runId, nodeRunId, schemaJson, schemaHash,
storageRef, format, partitionJson, rowCount, byteCount,
watermark, sampleRef, expiresAt, createdAt
```

#### `dataflow_lineage_edge`

```text
id, runId, sourceArtifactId, targetArtifactId,
nodeRunId, columnMappingJson, createdAt
```

#### `data_source_test_run`

保存真实连接测试证据，不允许客户端直接设置 `verified`。

### 10.4 迁移规则

1. 迁移必须只增字段/表，不删除旧字段；
2. 先部署兼容读代码，再执行迁移，再开启写新字段；
3. `workflow_run.flowType` 从关联 `workflow.flowType` 回填；
4. 历史运行没有权威当前状态时保持 `currentStateCode=NULL`，不得伪造；
5. 历史任务 `operationCode` 可用 nodeId 回填兼容值，但标记 `legacy`；
6. 已发布 V1 计划继续按 V1 快照运行；
7. 新发布和回滚发布生成 V2 计划；
8. 数据旧流程重新发布前运行兼容检查，存在不支持节点时保持旧发布状态但禁止新运行；
9. 所有迁移先在备份副本验证，保留回滚 SQL；
10. 禁止使用破坏性重建替代增量迁移。

---

## 11. 服务端模块改造清单

### 11.1 共享合同

| 文件                               | 改造                                                                |
| ---------------------------------- | ------------------------------------------------------------------- |
| `shared/workflow-node-contract.ts` | 加入 category、ports、maturity、sideEffect；拆分数据 Transform 语义 |
| `shared/flow-profile-contract.ts`  | 新增三类 Profile、节点白名单和创建模板                              |
| `shared/state-flow-contract.ts`    | 状态、操作、结果和人员选择器类型                                    |
| `shared/control-flow-contract.ts`  | ServiceTask、Wait、Event、补偿策略类型                              |
| `shared/data-flow-contract.ts`     | Dataset Schema、Source、Join、Sink、DQ 类型                         |

### 11.2 编译与发布

| 文件                          | 改造                                                    |
| ----------------------------- | ------------------------------------------------------- |
| `server/workflow-compiler.ts` | 强制接收 flowType；调用 Profile 语义校验；生成 V2 计划  |
| `server/workflow-service.ts`  | 查询并传递 flowType；保存、发布、编译草稿、回滚全部统一 |
| `server/project-service.ts`   | 创建后 flowType 不可变；按类型生成默认定义              |
| `server/runtime-info.ts`      | 返回各 Profile 和节点能力状态                           |

所有调用 `compileWorkflowDefinition()` 的位置必须改成显式类型调用。禁止保留无类型重载。

### 11.3 状态/控制运行

| 文件                               | 改造                                                      |
| ---------------------------------- | --------------------------------------------------------- |
| `server/workflow-engine.ts`        | 拆分调度器与 NodeExecutor；按结果 Handle 续跑；写状态迁移 |
| `server/p1-service.ts`             | 扩展 outcome、代理、转办、任务版本 CAS                    |
| `server/organization-service.ts`   | ParticipantResolver 注册表和可解释结果                    |
| `server/workflow-worker.ts`        | Timer 扫描、事件恢复；后续 token/join 支持                |
| `server/workflow-authorization.ts` | 新增统一 authorize 入口，收敛 mutation 权限               |

推荐逐步拆分目录：

```text
server/workflow/
  compiler/
  runtime/
    state-executor.ts
    control-executor.ts
    node-executors/
  authorization/
  participants/
  timers/
```

第一批不做纯目录搬迁；优先增加合同和保护逻辑，避免大范围无功能重构。

### 11.4 数据运行

将 `runDataflowDefinition()` 拆成：

```text
server/dataflow/
  compiler.ts
  worker.ts
  scheduler.ts
  artifact-store.ts
  lineage-service.ts
  connectors/
  executors/
    source.ts
    sql.ts
    filter.ts
    project.ts
    join.ts
    aggregate.ts
    quality-gate.ts
    sink.ts
```

`server/p2-service.ts` 保留 API 编排和权限，不再直接包含整个 DAG 执行算法。

---

## 12. API 与 tRPC 合同

### 12.1 流程编译

请求不允许客户端自行声明权威 `flowType`；服务端通过 workflowId 查询。

```ts
workflow.compileDraft({ workflowId, definition? })
  -> {
    ok,
    flowType,
    profileVersion,
    diagnostics,
    requiredCapabilities,
    planHash?
  }
```

### 12.2 状态/控制启动

```ts
workflow.run({ workflowId, input, businessKey?, idempotencyKey })
```

规则：

- 查询 workflow.flowType；
- `data` 立即返回 `WF_PROFILE_RUNTIME_MISMATCH`；
- `state` 可要求 `businessKey`；
- `control` 不写业务状态；
- 授权快照包含有效角色来源和部门继承来源摘要。

### 12.3 数据启动

```ts
data.run({ projectId, workflowId, input, idempotencyKey? })
```

规则：

- 只接受 `flowType=data`；
- 使用发布计划而不是重新解释草稿 definition；
- 返回 queued run，不在 HTTP 请求内同步跑完整 DAG；
- 计划调度和手动运行进入同一 Worker 队列。

### 12.4 任务完成

```ts
task.complete({
  taskId,
  ownerVersion,
  outcome,
  comment?,
  formData?
})
```

服务端从任务快照读取允许 outcome，不能相信客户端提交的目标节点。

### 12.5 人员预览

```ts
workflow.previewParticipants({
  workflowId,
  nodeId,
  sampleContext,
  actorUserId?
})
```

仅有编辑权限的用户可调用；结果返回候选人、排除原因、兜底和组织来源，不返回敏感账号信息。

### 12.6 事件回调

```text
POST /api/workflow-events/:eventType
```

必须具备：

- 签名或服务身份认证；
- eventId 幂等；
- correlationKey；
- 请求体 Schema 和大小限制；
- 审计和重复事件策略。

---

## 13. 权限与职责分离

### 13.1 权限层次

| 层次     | 权限示例                                         |
| -------- | ------------------------------------------------ |
| 系统     | `workflow:create`、`iam:manage`                  |
| 项目     | `project:view/edit/manage/run`                   |
| 流程     | `workflow:view/edit/publish/run/members:manage`  |
| 任务     | candidate、owner、delegate、admin-queue          |
| 数据资源 | `data:source:view/use/manage`、`data:sink:write` |
| Secret   | `secret:use`，不等同于 `secret:view`             |
| 审计     | `audit:view/export`                              |

### 13.2 统一授权入口

```ts
authorize({
  actor,
  action,
  resource,
  context,
}) -> AuthorizationDecision
```

返回：

```ts
type AuthorizationDecision = {
  allowed: boolean;
  reasonCode: string;
  matchedRoles: string[];
  inheritedFromUnits: string[];
  effectiveUntil?: string;
};
```

拒绝优先于允许。管理员不自动绕过当前任务所有权；紧急绕过必须走独立命令、二次授权、必填原因和高风险审计。

### 13.3 任务操作校验顺序

1. 用户账号 active；
2. 运行实例状态可操作；
3. 当前 Profile 为 state/control；
4. 任务状态可操作；
5. 当前状态/当前节点匹配；
6. 当前操作集合包含 taskId；
7. pending 任务校验候选人；
8. claimed 任务只校验 claimedByUserId；
9. ownerVersion 未变化；
10. outcome 在任务快照允许集合中；
11. 表单和意见校验；
12. 记录授权决策摘要。

### 13.4 部门继承

- 部门绑定系统角色继续实时生效；
- `includeDescendants`、生效期、失效期、撤销和账号状态必须同时判断；
- 部门权限可以授予运行、查看、编辑等能力；
- 人工任务候选人从部门解析后固化快照；
- 解绑部门角色会阻止新任务解析和新权限请求，但不静默改写已完成审批证据；
- 存量 pending 任务是否撤权由显式“撤权策略”处理，并留下审计。

---

## 14. 前端设计器详细改造

### 14.1 信息架构

设计器顶部固定展示：

```text
流程类型｜草稿/发布状态｜能力状态｜未保存状态｜校验｜保存｜提交审核｜发布
```

流程类型创建后只读。尝试更改时提供“另存为其他类型”，执行节点迁移预览，不原地修改。

### 14.2 节点目录

桌面端使用可折叠左侧目录，不再把全部节点放在一条横向工具栏：

```text
状态流程
  基础：开始、结束、状态
  人员：人工操作、表单
  决策：条件、路由
  集成：服务任务、子流程
  智能：LLM
  时间与通知：Timer、消息、通知

控制流程
  触发、编排、决策、集成、人工闸门、智能、异常处理

数据流程
  输入、转换、关联、质量、输出
```

支持搜索、最近使用和收藏。节点显示 maturity 徽标：生产、Beta、实验、禁用。

### 14.3 节点卡片

状态节点显示：状态代号、类型、角色数、操作数。
人工节点显示：人员模式、候选人数预警、签署模式、阈值、SLA。
服务任务显示：方法、EndpointRef、超时、重试、幂等。
LLM 显示：模型、结构化输出、人工复核、失败分支。
数据节点显示：输入/输出 Schema、字段数、行数估计和能力状态。

### 14.4 配置面板

将当前通用 JSON 字段编辑器逐步替换为结构化配置：

- 人员选择器；
- 结果出口；
- 签署策略；
- Schema 编辑器；
- Retry/Timeout/Idempotency；
- Join 键映射；
- DQ 规则；
- Sink 写入策略。

兼容原版字段放入“迁移兼容信息”，默认折叠且只读；未知字段完整保存。

### 14.5 校验体验

- 校验结果按 P0/P1/警告分组；
- 点击诊断定位节点、连线或配置字段；
- 发布按钮在存在 error 时禁用；
- 能力 disabled 时显示部署原因；
- 对人员节点提供“使用样例上下文预览候选人”；
- 对数据节点提供 Schema 传播预览；
- 对有副作用节点显示幂等/补偿未配置提示。

### 14.6 375px 布局

- 节点目录改为底部抽屉；
- 配置面板使用全屏 Sheet；
- 画布操作收纳到菜单；
- 保存、校验、发布固定在底部操作栏；
- 所有主要触控目标至少 44px；
- 页面根节点必须满足 `scrollWidth === innerWidth`；
- 表格在窄屏改摘要卡片，不依赖 1500px 宽表格横向操作；
- Drawer 支持 Escape、遮罩关闭、焦点锁定和可访问标题。

### 14.7 文件级前端改造

| 文件                       | 改造                                      |
| -------------------------- | ----------------------------------------- |
| `WorkflowCanvas.tsx`       | 只保留画布协调，节点目录和 Inspector 拆分 |
| `flow-profile-ui.ts`       | Profile 分类、标签、说明和模板            |
| `StateNodeInspector.tsx`   | 状态和操作配置                            |
| `ControlNodeInspector.tsx` | 服务、LLM、重试、等待配置                 |
| `DataNodeInspector.tsx`    | Schema、Join、DQ、Sink 配置               |
| `WorkflowCompilePanel.tsx` | 诊断、定位、能力状态                      |
| `ParticipantPreview.tsx`   | 候选人解析预览                            |
| `DatasetSchemaPanel.tsx`   | Schema 传播和差异                         |

---

## 15. 运行、审计与可观测性

### 15.1 统一链路字段

每个流程运行、Job、节点运行、任务、状态迁移、Timer、Outbox、数据 Artifact 必须包含或可关联：

```text
requestId
workflowId
runId
flowType
planHash
nodeId
nodeRunId
actorUserId（如适用）
idempotencyKey（如适用）
```

### 15.2 审计事件目录

至少新增：

```text
workflow.published
workflow.run.submitted
workflow.state.entered
workflow.operation.claimed
workflow.operation.completed
workflow.operation.transferred
workflow.operation.delegated
workflow.approval.group.completed
workflow.timer.created
workflow.timer.fired
workflow.event.consumed
workflow.run.cancelled
workflow.run.terminated
dataflow.run.submitted
dataflow.node.completed
dataflow.quality.failed
dataflow.sink.committed
dataflow.watermark.committed
```

审计保存 before/after 摘要，不保存凭据和大数据集。

### 15.3 指标

状态/控制：

- queue age；
- Worker lease recovery；
- engine time、external time、human time；
- task pending age；
- approval group completion rate；
- retry、compensation、timer misfire；
- LLM Token、费用、超时和 Schema 失败。

数据：

- 节点输入/输出行数和字节数；
- Connector 读取速率；
- 数据质量失败率；
- Sink commit 和幂等跳过数；
- Checkpoint 恢复次数；
- 水位延迟；
- Schema 漂移次数。

### 15.4 建议初始 SLO

以下为验收目标，不是当前已实现能力：

- 500 节点无循环定义编译 P95 小于 2 秒；
- 当前任务授权检查 P95 小于 300ms；
- Worker 崩溃后在租约过期加 30 秒内恢复；
- 相同幂等键不产生第二个运行或第二次 Sink 提交；
- 375px 登录后核心业务页无根级横向溢出；
- 数据质量和 Sink 结果能够从运行记录追溯到计划哈希和输入 Artifact。

---

## 16. 安全设计

### 16.1 HTTP和外部服务

- 延续固定 DNS 解析和私网地址拒绝；
- 建立租户/项目 Endpoint 白名单；
- 禁止 URL 内凭据；
- SecretRef 在服务端注入；
- 拒绝自动重定向或逐跳重新验证；
- 限制超时、响应大小和并发；
- 写操作必须带稳定幂等键。

### 16.2 SQL和数据

- 只读账号和写入账号分离；
- SQL Parser/Query Builder，不依赖正则作为唯一防线；
- 参数绑定；
- 限制执行时间、扫描量、返回行数；
- Sink 使用单独写权限；
- 样本和错误行必须脱敏并设置保留期；
- 数据 Artifact 引用不得允许跨项目读取。

### 16.3 LLM

- Provider Secret 不进入定义；
- 数据分类和字段白名单；
- Prompt 注入视为不可信输入；
- 模型结果不直接决定权限、资金或终态；
- 输出 Schema 二次校验；
- Token 和费用上限；
- 记录模型和版本，但对 Prompt/Response 做敏感字段脱敏。

### 16.4 UDF

- 禁止在主服务进程直接执行 Python、JavaScript 或 JAR；
- 使用隔离 Worker/Sandbox；
- 默认无网络、只读输入、临时文件系统、CPU/内存/时限；
- Artifact 哈希和签名校验；
- 审核版本固定；
- Sandbox 不可用时发布失败。

---

## 17. 兼容性与灰度策略

### 17.1 定义兼容

- `schemaVersion=1` 继续可读取和编辑；
- 编译时先规范化为内部 V2；
- 新保存可继续保留 V1 外形，直到前后端 V2 同时稳定；
- 未知字段必须保留；
- `nodeDh/jdmc/czmc/bdcz/lysz` 等原版字段继续映射；
- `rest/method/http` 编译为同一 ServiceTask 计划但不强制立即改写源定义；
- `edit_sql/output` 作为兼容别名，新增节点不再创建。

### 17.2 运行兼容

- 已启动实例始终使用自己的计划和定义快照；
- V1 计划继续由 V1 兼容执行路径运行；
- V2 只影响重新发布后的新实例；
- 严禁后台批量替换运行中实例计划；
- 数据旧定义若包含当前运行时不支持节点，先禁止新运行并提示重新发布诊断。

### 17.3 Feature Flags

建议：

```text
FLOW_PROFILE_V2_COMPILE
STATE_OUTCOME_ROUTING_V2
CONTROL_TIMER_V1
DATAFLOW_ENGINE_V2
DATAFLOW_REAL_CONNECTOR
WORKFLOW_PARALLEL_TOKENS
```

Flag 只控制新能力入口，不能绕过数据库迁移和安全校验。

### 17.4 回滚

- 关闭 V2 发布入口；
- 继续运行已固化 V2 计划的实例，不能用旧代码无法识别的版本直接回滚部署；
- 因此上线前旧代码必须能够识别并拒绝 V2 新运行，或保留兼容执行镜像；
- 新表和新字段回滚时保留，不做破坏性删除；
- 数据 Sink 上线前必须准备目标侧幂等和业务回滚方案。

---

## 18. 测试设计

### 18.1 单元测试

Profile 编译至少覆盖：

1. 三类合法最小流程；
2. 每个跨类型节点拒绝；
3. 端口类型不匹配；
4. 状态流程无状态；
5. 操作结果出口缺失；
6. 状态代号重复；
7. 控制写节点缺少幂等/补偿；
8. 数据无 Source/Sink；
9. Join 键缺失；
10. Union Schema 不兼容；
11. 数据循环拒绝；
12. 能力 disabled 阻断；
13. V1 到 V2 稳定规范化；
14. 相同语义不同节点顺序生成相同哈希；
15. flowType 变化导致计划哈希变化。

### 18.2 MySQL 状态流程集成测试

至少覆盖：

- 状态进入和迁移原子性；
- 单人同意进入批准状态；
- 拒绝进入驳回状态而不是默认取消；
- 非当前候选人、非领取人、非当前状态拒绝；
- 管理员不能代替当前领取人；
- 部门成员继承新任务候选资格；
- 部门解绑后新任务不再继承；
- 存量候选快照不被静默修改；
- 或签并发只推进一次；
- 会签阈值和“不可能达到阈值”拒绝；
- 顺序会签只激活当前一人；
- 弃权计数；
- ownerVersion 防止转办/完成竞争；
- 重复 complete 请求幂等；
- 状态迁移和 resume job 同事务。

### 18.3 MySQL 控制流程集成测试

- API 启动幂等；
- HTTP 写操作稳定幂等 Header；
- 超时分类重试；
- 非重试错误直接失败；
- Checkpoint 后杀 Worker 可恢复；
- 已成功副作用节点不重复执行；
- Timer 重启补触发一次；
- 事件重复回调不重复推进；
- LLM 失败走失败分支；
- 子流程快照不随源定义变化；
- 取消、终止和失败状态语义分离。

### 18.4 数据流程集成测试

- 数据流程只能走 data.run；
- 真实 MySQL 只读 Source；
- SQL 参数绑定和禁止 DML；
- Schema 推断和不兼容阻断；
- Filter、Project、Derive 结果；
- Join 四种类型和键冲突；
- Union 对齐策略；
- Aggregate、去重；
- DQ 成功、失败、隔离；
- Sink 幂等重试；
- 失败不提交水位；
- Worker 重启从 Artifact Checkpoint 恢复；
- 项目 A 不能引用项目 B 的 Source/Artifact/Sink；
- 运行计划哈希与发布版本一致。

### 18.5 授权矩阵

身份至少包括：

```text
匿名用户
项目查看者
项目编辑者
流程所有者
部门继承运行者
当前候选人
当前领取人
非当前候选人
审计员
系统管理员
紧急操作员
```

每个 mutation 都要有允许和拒绝用例，不能只测试页面是否隐藏按钮。

### 18.6 Provider测试

LLM：真实模型成功、Schema 错误、超时、失败分支、usage、费用上限。
HTTP：公网成功、超时、DNS 变化、重定向、IPv4/IPv6 私网、超大响应。
Data Connector：连接失败、凭据错误、只读限制、查询超时、Sink 重复提交。

### 18.7 浏览器E2E

状态流程：创建、配置人员、审核、发布、发起、领取、同意、拒绝、查看状态历史。
控制流程：配置 HTTP/LLM、发布、运行、查看节点输出和失败分支。
数据流程：选择资源、设计 DAG、Schema 预览、运行、查看行数、DQ 和血缘。

视口：320、375、390、768、1440。
验收必须记录目标 Git SHA、数据库迁移版本、浏览器角色和实际业务结果。

### 18.8 故障注入

至少执行：

1. 节点执行前杀 Worker；
2. 外部调用成功、Checkpoint 前杀 Worker；
3. 任务完成事务中断；
4. Timer 到期时重启；
5. Sink 提交成功、节点完成记录前中断；
6. Outbox 派发中断；
7. MySQL 短时不可用；
8. 多 Worker 同时领取。

验收结果必须证明“不丢、不重、可解释”，不能只证明服务重新启动。

---

## 19. 发布门禁

每个批次至少执行：

```powershell
pnpm check
pnpm test:unit
pnpm build
git diff --check
```

涉及数据库、Worker、授权或真实 Connector 时必须额外执行：

```powershell
pnpm test:integration:mysql
pnpm test:integration:authorization
pnpm test:integration:worker
```

涉及 LLM/HTTP Provider 时执行：

```powershell
pnpm test:integration:provider
```

涉及前端交互时必须运行正式浏览器 E2E。未配置真实依赖时应报告“未验收”，不得以 skip 或单元测试代替。

---

## 20. 文件级实施顺序

### 批次 A：Profile 服务端安全边界

1. 新建 `shared/flow-profile-contract.ts`；
2. 为现有节点定义补齐 category、ports、maturity；
3. 改造 compiler options，强制 flowType；
4. 修改 workflow-service 所有编译调用；
5. 修改 workflow-engine/data.run 的运行入口校验；
6. 数据 Profile 仅允许 P2 当前支持节点；
7. 前端从共享 Profile 读取目录；
8. 添加跨类型定义和运行入口测试。

该批次不需要数据库迁移，风险最低，应最先实施。

### 批次 B：人工结果路由和状态事实

1. 迁移 workflow_run/task/task_group；
2. 新建 workflow_state_transition；
3. 操作配置增加 outcomes；
4. 完成任务事务按组结果选择 Handle；
5. 拒绝不再默认取消；
6. 状态卡片和历史 UI；
7. 完成 MySQL 并发验收。

### 批次 C：表单、人员和 SLA

1. 表单 Schema 版本化；
2. 表单附着到开始/任务；
3. ParticipantResolver 注册表；
4. 部门、部门负责人、N级主管、表单用户；
5. 候选人预览；
6. Timer 和提醒；
7. 转办/代理/加签减签后续独立小批次。

### 批次 D：控制流程生产节点

1. ServiceTask 收敛；
2. EndpointRef/SecretRef；
3. Retry/Idempotency/Compensation；
4. Wait/Message；
5. LLM 治理；
6. 故障注入。

### 批次 E：数据流程 V2

1. 数据计划和耐久表；
2. Dataflow Worker；
3. Inline/MySQL Connector；
4. Source/SQL/Filter/Project；
5. Artifact/Checkpoint/Lineage；
6. Join/Union/Aggregate/DQ；
7. Sink 幂等；
8. 真实数据 E2E；
9. 能力从 experimental 升到 beta。

### 批次 F：并行、循环和高级运行

1. token/node instance/join state；
2. Fork/Join；
3. 有界循环；
4. 补偿栈；
5. 多 Worker 并发和故障注入；
6. 能力稳定后移除发布阻断。

---

## 21. 风险与控制措施

| 风险                             | 控制措施                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| Profile 校验使旧流程无法重新发布 | 提供兼容诊断和迁移预览，不修改已发布计划                     |
| 拒绝路由改变现有取消语义         | 旧节点没有 outcomes 时维持 legacy_cancel；新节点必须显式配置 |
| 状态事实与参与人状态不一致       | 状态迁移和参与人更新放在同一事务，增加对账任务               |
| 数据真实执行造成资源压力         | 行数、字节、时间、并发和分区限制；先只读 Connector           |
| Sink 重试重复写入                | 强制幂等键和目标侧唯一约束                                   |
| UDF 逃逸                         | 未有 Sandbox 前不执行                                        |
| LLM 不确定性影响业务             | Schema、规则校验、人工复核和失败分支                         |
| 大规模重构难以回滚               | 按小批次增加合同和适配层，不先做目录搬迁                     |
| 前后端节点合同漂移               | 共享 Profile 注册表，服务端发布为最终权威                    |
| 真实依赖测试被 skip              | 分层命令缺依赖时显式失败，验收报告注明环境                   |

---

## 22. 可执行 Todo List

### P0：Profile 与运行入口

- [x] **3F-P0-001** 已新建 FlowProfile 注册表和三类第一阶段白名单，数据白名单与当前 P2 执行器对齐。
- [x] **3F-P0-002** 编译器所有 API 已强制接收 `flowType`，新执行计划固化 Profile 并纳入哈希。
- [x] **3F-P0-003** `workflow-service` 保存、发布、编译草稿、回滚均读取并传递数据库 flowType。
- [x] **3F-P0-004** 状态/控制运行入口已拒绝 data；data.run 继续通过数据库查询只接受 data。
- [x] **3F-P0-005** 前端目录已与服务端 Profile 同源，不再展示数据运行时不支持的 HTTP、条件和子流程节点。
- [x] **3F-P0-006** SQL 配置权威字段已统一为 `statement`，编译和运行兼容读取 `sql/query`。
- [~] **3F-P0-007** 已增加并测试 `WF_PROFILE_NODE_FORBIDDEN`；状态语义、端口和能力诊断码随对应后续批次落地。
- [~] **3F-P0-008** 已覆盖跨类型恶意定义、Profile 哈希和错误运行入口静态回归；真实 MySQL API 入口与能力关闭集成测试仍待补验。

### P0：状态流程业务正确性

- [x] **3F-P0-020** 状态 Profile 已强制至少一个状态、唯一初始状态和至少一个业务终态，并提供稳定诊断码。
- [x] **3F-P0-021** 操作节点已增加显式 outcomes、唯一 Handle 校验和画布多出口。
- [x] **3F-P0-022** 任务完成已按单签/或签/会签任务组最终结果选择唯一分支。
- [x] **3F-P0-023** 新操作节点拒绝已进入显式拒绝分支，不再默认取消实例。
- [x] **3F-P0-024** 旧节点保持 `legacy_cancel`，设计器显示明确迁移提示。
- [x] **3F-P0-025** 已新增状态迁移表、运行 currentState/stateVersion、状态变更 Outbox 和实例历史 UI。
- [~] **3F-P0-026** 任务决定、任务组关闭、节点完成、运行排队和续跑 Job 已合并为单事务；进入目标状态时的状态事实与参与人更新在 Worker 内另一个原子事务完成，尚需进一步收敛为同一命令事务或证明两阶段恢复合同。
- [ ] **3F-P0-027** 真实 MySQL 并发审批和重复推进测试。

### P1：人员、表单和时间

- [x] **3F-P1-001** ParticipantResolver 已形成注册表，并返回 selector、excluded、fallbackApplied、resolvedAt 等可解释证据。
- [x] **3F-P1-002** 已支持部门及后代部门、部门负责人、直属/N级主管和表单用户字段选择器。
- [x] **3F-P1-003** 人工任务创建时已固化候选人及完整解析快照；任务执行授权读取任务快照和当前参与人状态，不随组织查询漂移。
- [~] **3F-P1-004** 设计器已提供基于当前用户的候选人预览，静态空配置由节点校验阻断、运行时空结果默认阻塞；仍需补充可选择模拟发起人和表单样例的高级预览。
- [~] **3F-P1-005** 已支持 formSchemaVersion、任务表单 Schema 快照、必填校验和任务截止时间；独立表单发布物及兼容迁移仍待补齐。
- [x] **3F-P1-006** 任务领取、转办和退回均使用 ownerVersion CAS，转办同时原子迁移当前参与人可操作集合。
- [~] **3F-P1-007** Timer、提醒、催办、升级和重启补触发。Wait Timer 已耐久化；人工任务已建立提醒/到期/升级计划，Worker 事务性补触发并支持顺序会签交接后重新起算；待真实 MySQL 重启验收。
- [~] **3F-P1-008** 加签、减签、代理和责任主体审计。已实现现有或签/会签组的动态加签与未处理成员减签，成员变更使用 memberVersion CAS；任务代理持久化责任人、被代理人和代理关系并传入状态迁移审计。待补前加签/后加签编排、时间段休假代理和真实 MySQL 多身份并发验收。

### P1：控制流程

- [x] **3F-P1-020** REST/HTTP/METHOD 已编译为统一 HTTP ServiceTask 计划，执行计划固化 effect、幂等策略、重试分类与超时，运行时统一消费该映射。
- [x] **3F-P1-021** 已增加项目级 EndpointRef 目录、域名允许列表和外部 SecretRef；项目流程发布/运行均禁止绕过目录，密钥值不进入数据库、定义、执行计划或审计。
- [~] **3F-P1-022** 已实现瞬时错误分类、有界指数退避、Endpoint/并发键级熔断和并发限制；当前熔断/并发状态为单 Worker 内存范围，集群级共享配额仍待耐久协调器。
- [x] **3F-P1-023** 写服务任务发布前必须声明远端幂等或补偿策略；仅幂等写允许自动重试，补偿策略必须通过 compensation 出口连接有效节点。
- [x] **3F-P1-024** Wait 和 Message Catch 已持久化订阅、Checkpoint、Timer 补触发及相关键消息触发；触发命令通过唯一 resume job 恢复，服务重启不丢等待事实。
- [x] **3F-P1-025** LLM 已增加可信模型定价目录、调用前最坏费用门禁、实际 usage/费用审计、数据分类与字段级敏感白名单；凭据永不放行、响应再次脱敏。确定性 Schema/允许值由服务端复核，启用人工复核时编译器强制直连非自动人工操作节点。未实现的 `prompt_hash` 缓存会被明确拒绝。
- [x] **3F-P1-026** 控制流程目录不再提供业务状态节点，新增独立 Milestone 节点；里程碑代号在控制流程内唯一，运行时写入幂等的不可变里程碑事实并在实例详情展示，但不会修改 `currentStateCode`、参与人或操作权限。
- [~] **3F-P1-027** 已增加仅测试环境可启用的“执行完成、Job 完成前崩溃”注入点，并新增终态 Run 与残留 queued/leased Job 的自动对账；MySQL 集成用例验证恢复时不会再次写入 Milestone。当前环境未配置 `DATABASE_URL`，真实故障注入用例尚未执行，完成前不得升级为 production。

### P1：数据流程 V2

- [~] **3F-P1-040** 数据 ExecutionPlan V2 和 plan hash。已在发布阶段编译 dataflow profile 不可变计划，运行时校验 SHA-256 哈希并仅按计划拓扑顺序执行；dataflow_run 固化定义、计划、哈希和 requestId。待真实 MySQL 迁移与运行快照验收后完成。
- [~] **3F-P1-041** 已增加 `dataflow_run_job / dataflow_node_run` 耐久运行表：运行与根 Job 同事务创建，Worker 通过 `FOR UPDATE SKIP LOCKED`、租约、续租、过期回收和有界退避执行；每个节点固化稳定顺序、输入、输出、行数、耗时、Attempt 和失败事实，损坏计划会终止对应 Job 而不会永久毒化队列。待真实 MySQL 迁移、并发领取、进程重启和租约故障注入验收后完成。
- [~] **3F-P1-042** 已实现逐节点 Dataset Artifact、Run Checkpoint 和 Artifact 级 Lineage：节点提交在有效 Job 租约下原子写入 NodeRun、Artifact、依赖边与 Checkpoint，租约交接后的旧 Worker 不能覆盖新 Attempt；重试从成功 Artifact 恢复并跳过已提交节点，运行审计提供项目权限保护的 Artifact/Lineage 查询。当前仅支持有界 `inline_json` Artifact 和节点依赖级血缘；外部对象存储、列级映射、水位提交及真实 MySQL 崩溃恢复验收仍待完成。
- [~] **3F-P1-043** 已增加独立 `data_source_test_run` Job：配置哈希绑定、租约/过期回收、真实 API GET 与受白名单约束的 MySQL `SELECT 1` 探测、内联元数据探测，以及策略/DNS/网络/超时/认证/授权/数据库/配置漂移分类。仅成功测试可把数据源原子标记为 `verified`，证据脱敏且不保存凭据；文件读取器和真实 MySQL/Provider 验收仍待完成。
- [~] **3F-P1-044** 已接入 Inline 与已验证 MySQL 只读 Connector：Source 节点读取内联样本或白名单 MySQL 表，执行限制行数和安全标识符校验；API/文件 Connector 仍未启用。
- [~] **3F-P1-045** SQL 节点已执行已验证 MySQL 数据源的单条只读 SELECT，支持命名参数绑定、行数上限及禁止 DML/DDL/文件写出；SQL Parser、真实 Schema 推断和列级依赖仍待完成。
- [~] **3F-P1-046** 已将 Filter、Project、Derive 拆分为独立节点和运行语义：Filter 支持确定性比较，Project 支持选择/重命名，Derive 仅允许字段引用、数值/布尔/字符串常量；复杂安全表达式与 Cast 仍待补齐。
- [~] **3F-P1-047** 已增加 Join、Union、Aggregate、Sort、Deduplicate 运行节点：Join 明确左右输入和键，Union 支持 all/distinct，Aggregate 支持 count/sum/min/max，Sort 与 Deduplicate 为确定性操作；发布期输入基数/Schema 校验仍需加强。
- [~] **3F-P1-048** 已增加 Quality Gate 节点，按最少行数和空值率执行确定性校验；失败会终止当前 Job，且不会写入成功输出 Artifact。独立隔离区/失败样本存储仍待实现。
- [ ] **3F-P1-049** Sink 写入权限、Schema 策略和幂等提交。
- [ ] **3F-P1-050** 失败不提交水位，重启从 Checkpoint 恢复。
- [ ] **3F-P1-051** 数据流真实 MySQL 端到端和跨项目拒绝测试。

### P2：高级能力与体验

- [ ] **3F-P2-001** execution token、node instance 和 join state。
- [ ] **3F-P2-002** Fork/Join 和 n-of-m 汇聚。
- [ ] **3F-P2-003** 有界循环和迭代审计。
- [ ] **3F-P2-004** 补偿栈和 Saga 运行监控。
- [ ] **3F-P2-005** 数据增量水位、分区和流式 Connector。
- [ ] **3F-P2-006** 数据专用批量 LLM/Embedding 节点。
- [ ] **3F-P2-007** 三类流程设计器分类、搜索、最近使用和收藏。
- [ ] **3F-P2-008** 320/375/390/768/1440 正式浏览器业务 E2E。

### 22.1 与现有总 Todo 的映射

本报告的 `3F-*` 是三类流程专项实施编号，不替代
`flow-engine-deep-audit-remediation-todo-2026-08-23.md` 中的总治理编号。实施提交应同时更新两边状态，避免出现两个互相矛盾的完成口径。

| 本报告范围         | 现有总 Todo                              | 关系                                                               |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------ |
| `3F-P0-001`～`008` | T0101～T0105、T0410～T0411               | 在已有通用编译器上增加 Profile、运行入口和能力校验                 |
| `3F-P0-020`～`027` | T0130～T0142、T0240～T0251               | 补齐结果路由、权威状态、所有权和并发事务                           |
| `3F-P1-001`～`008` | T0211、T0220～T0240、T0280～T0281、T0520 | 人员、部门、表单、代理、SLA 和候选预览                             |
| `3F-P1-020`～`027` | T0401～T0441                             | LLM、HTTP、Secret、重试、补偿和真实 Provider                       |
| `3F-P1-040`～`051` | T0450～T0463                             | 数据源验证、真实 Connector、Worker、Checkpoint、血缘和 UDF Sandbox |
| `3F-P2-001`～`004` | T0201～T0202                             | 可靠并行、汇聚、循环和补偿                                         |
| `3F-P2-007`～`008` | T0310～T0321、T0510～T0512               | 设计器信息架构、窄屏和可访问性验收                                 |

---

## 23. 每批 Definition of Done

一个 Todo 批次只有同时满足以下条件才可标记完成：

1. 共享合同、服务端实现和前端展示一致；
2. 编辑态可以保存，发布态按 Profile 严格阻断；
3. 不修改已有发布计划和运行实例快照；
4. 权限拒绝由服务端执行，并有反向测试；
5. 数据库迁移在备份副本通过并有回滚说明；
6. 单元、TypeScript、构建和 diff 检查通过；
7. 涉及 MySQL 的真实集成测试通过；
8. 涉及 Provider 的真实 Provider 测试通过；
9. 涉及 UI 的真实浏览器多角色和窄屏测试通过；
10. 运行能力状态、文档和 Todo 同步更新；
11. 提交只包含本批相关文件，不吸收工作区其他未跟踪文件；
12. 验收报告记录 Git SHA、迁移版本、环境和仍未验证边界。

---

## 24. 最终验收场景

### 24.1 状态流程验收

以请假或采购审批为例：

- 创建状态流程并配置已提交、审批中、已通过、已驳回；
- 部门角色自动解析审批候选人；
- 非候选人不能领取；
- 当前领取人才能完成；
- 或签、比例会签、顺序会签和弃权结果正确；
- 拒绝进入已驳回状态，不默认取消实例；
- 状态历史、任务证据、组织来源和 requestId 可追溯；
- Worker 中断后不重复推进。

### 24.2 控制流程验收

- API 幂等启动；
- 调用受控 HTTP 服务；
- LLM 返回结构化结果；
- 高风险结果进入人工闸门；
- 超时进入失败分支；
- 已成功外部调用不因恢复重复执行；
- 需要时执行补偿；
- 运行指标区分队列、引擎、外部和人工耗时。

### 24.3 数据流程验收

- 使用真实只读 MySQL Source；
- Schema 在画布可见并沿边传播；
- Filter、Join、Aggregate 结果与基准 SQL 一致；
- DQ 失败进入隔离输出；
- Sink Upsert 重试不重复；
- Worker 中断后从 Artifact Checkpoint 恢复；
- 运行记录能追溯输入水位、计划哈希、行数和血缘；
- 跨项目 Source、Artifact、Sink 全部拒绝。

只有三类场景分别完成代码、MySQL、Provider、浏览器和故障注入证据后，能力状态才可以升级为 production。

---

## 25. 实施结论

本次改造的第一原则不是立即增加所有节点，而是先让“流程类型、节点目录、编译合同和实际运行时”完全一致。

推荐立即实施顺序：

1. **Profile 服务端强约束和运行入口隔离**；
2. **状态流程结果路由与权威状态迁移**；
3. **人员、表单和 Timer**；
4. **控制流程 ServiceTask 与可靠性治理**；
5. **数据流程耐久执行、真实 Connector 和 Dataset 血缘**；
6. **并行、循环、补偿和高级数据能力**。

执行中不得以隐藏按钮代替服务端校验，不得以样本运行代替真实数据执行，不得以单元测试代替 MySQL、Provider 和浏览器业务验收。
