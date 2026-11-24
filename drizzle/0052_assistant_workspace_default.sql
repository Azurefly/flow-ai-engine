INSERT INTO `system_setting` (`key`, `valueJson`)
VALUES ('assistant.defaultAgent', JSON_OBJECT('agentId', 'flow-assistant', 'revision', 1))
ON DUPLICATE KEY UPDATE `key` = `key`;
--> statement-breakpoint
-- Extend the system seed while preserving administrator edits and pinned sessions.
UPDATE `assistant_agent`
SET `draftJson` = JSON_SET(`draftJson`,
      '$.tools', JSON_ARRAY('listMyTasks', 'searchWorkflows', 'listMyCompletedTasks', 'createWorkflowDraft', 'workspaceRead', 'workspaceWrite'),
      '$.greeting', '我可以帮你设计和检查流程、追踪运行、处理待办，也可以查询项目和数据资源。'
    ),
    `publishedJson` = `draftJson`,
    `draftVersion` = 4,
    `publishedVersion` = 4
WHERE `id` = 'flow-assistant' AND `updatedByUserId` IS NULL
  AND `draftVersion` = 3 AND `publishedVersion` = 3
  AND `draftJson` = `publishedJson`
  AND `draftJson` = JSON_OBJECT(
    'name', '流程助手',
    'greeting', '你好。你可以让我查待办、已办和流程，也可以在当前业务准备流程草稿。',
    'instructions', '请用中文回答，依据工具返回的系统数据说明结果。',
    'model', '',
    'tools', JSON_ARRAY('listMyTasks', 'searchWorkflows', 'listMyCompletedTasks', 'createWorkflowDraft'),
    'enabled', TRUE,
    'roles', JSON_ARRAY('user', 'admin'),
    'projectIds', JSON_ARRAY()
  );
