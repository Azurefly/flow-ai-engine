-- Upgrade the untouched seed from 0046. Administrator settings and pinned sessions keep their versions.
UPDATE `assistant_agent`
SET `draftJson` = JSON_SET(
      JSON_ARRAY_APPEND(`draftJson`, '$.tools', 'createWorkflowDraft'),
      '$.greeting', '你好。你可以让我查待办、已办和流程，也可以在当前业务准备流程草稿。'
    ),
    `publishedJson` = `draftJson`,
    `draftVersion` = 3,
    `publishedVersion` = 3
WHERE `id` = 'flow-assistant' AND `updatedByUserId` IS NULL
  AND `draftVersion` = 2 AND `publishedVersion` = 2
  AND `draftJson` = `publishedJson`
  AND `draftJson` = JSON_OBJECT(
    'name', '流程助手',
    'greeting', '你好。你可以让我查看自己的待办、已办，或查找流程。',
    'instructions', '请用中文回答，依据工具返回的系统数据说明结果。',
    'model', '',
    'tools', JSON_ARRAY('listMyTasks', 'searchWorkflows', 'listMyCompletedTasks'),
    'enabled', TRUE,
    'roles', JSON_ARRAY('user', 'admin'),
    'projectIds', JSON_ARRAY()
  );
