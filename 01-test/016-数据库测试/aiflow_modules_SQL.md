# AiFlowGraph 核心模块 SQL 信息文档

## 文档信息

| 字段 | 内容 |
| -- | -- |
| 模块名称 | AiFlowGraph 流程与数据流引擎持久层 |
| 模块英文名 | aiflow-persistence |
| 文档版本 | V1.0 |
| 创建日期 | 2026-09-15 |
| 创建人员 | AiTest 自动化测试团队 |
| 关联技术栈文档 | 01-test/011-测试分析/AiFlowGraph-技术栈设计文档.md |
| 关联源码路径 | flow-ai-engine/server |

## 变更记录

| 版本 | 日期 | 变更人 | 变更内容 |
| -- | -- | -- | -- |
| V1.0 | 2026-09-15 | AiTest 自动化测试团队 | 初始版本，梳理流程引擎、任务协同、安全审计等核心 SQL |

## SQL语句列表

### SQL-001 - 用户凭证查询与登录校验

**SQL语句**:

```sql
SELECT id, username, password, name, role, status
FROM user
WHERE username = ?
LIMIT 1;
```

**参数信息**:

| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| username | VARCHAR(64) | 登录用户名 |

**SQL样例**:

```sql
SELECT id, username, password, name, role, status
FROM user
WHERE username = 'admin'
LIMIT 1;
```

**关联文件**:
- `flow-ai-engine/server/internal-auth.ts`

---

### SQL-002 - 项目空间内流程清单分页与过滤查询

**SQL语句**:

```sql
SELECT id, projectId, processCode, name, description, flowType, status, auditStatus,
       definitionVersion, publishedAt, unpublishedAt, createdAt, updatedAt
FROM workflow
WHERE projectId = ?
  AND archivedAt IS NULL
  AND (? IS NULL OR flowType = ?)
  AND (? IS NULL OR auditStatus = ?)
  AND (? IS NULL OR status = ?)
  AND (? IS NULL OR name LIKE CONCAT('%', ?, '%') OR description LIKE CONCAT('%', ?, '%'))
ORDER BY createdAt DESC;
```

**参数信息**:

| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| projectId | VARCHAR(36) | 业务项目 ID |
| flowType | VARCHAR(32) | 流程类型过滤 |
| auditStatus | VARCHAR(32) | 审核状态过滤 |
| status | VARCHAR(32) | 发布状态过滤 |
| keyword | VARCHAR(160) | 模糊检索关键词 |

**SQL样例**:

```sql
SELECT id, projectId, processCode, name, description, flowType, status, auditStatus,
       definitionVersion, publishedAt, unpublishedAt, createdAt, updatedAt
FROM workflow
WHERE projectId = 'proj-001'
  AND archivedAt IS NULL
  AND ('state' IS NULL OR flowType = 'state')
ORDER BY createdAt DESC;
```

**关联文件**:
- `flow-ai-engine/server/project-service.ts`

---

### SQL-003 - 流程归档状态原子排他校验（防止已归档流程被调度执行）

**SQL语句**:

```sql
SELECT archivedAt, flowType
FROM workflow
WHERE id = ?
LIMIT 1
FOR UPDATE;
```

**参数信息**:

| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| id | VARCHAR(36) | 待执行流程 ID |

**SQL样例**:

```sql
SELECT archivedAt, flowType
FROM workflow
WHERE id = 'wf-leave-001'
LIMIT 1
FOR UPDATE;
```

**关联文件**:
- `flow-ai-engine/server/workflow-engine.ts`

---

### SQL-004 - 待办任务查询与防并发领取

**SQL语句**:

```sql
SELECT id, runId, workflowId, nodeId, title, status, assigneeUserId, signMode
FROM workflow_task
WHERE id = ? AND status = 'pending'
LIMIT 1
FOR UPDATE;
```

**参数信息**:

| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| id | VARCHAR(36) | 任务 UUID |

**SQL样例**:

```sql
SELECT id, runId, workflowId, nodeId, title, status, assigneeUserId, signMode
FROM workflow_task
WHERE id = 'task-uuid-001' AND status = 'pending'
LIMIT 1
FOR UPDATE;
```

**关联文件**:
- `flow-ai-engine/server/p1-service.ts`
