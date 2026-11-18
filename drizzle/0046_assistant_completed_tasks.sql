-- Upgrade only the untouched, seeded assistant. Existing conversations retain their pinned tools.
UPDATE `assistant_agent`
SET `draftJson` = JSON_SET(JSON_ARRAY_APPEND(`draftJson`, '$.tools', 'listMyCompletedTasks'),
                          '$.greeting', '你好。你可以让我查看自己的待办、已办，或查找流程。'),
    `publishedJson` = `draftJson`,
    `draftVersion` = 2,
    `publishedVersion` = 2
WHERE `id` = 'flow-assistant' AND `updatedByUserId` IS NULL
  AND `draftVersion` = 1 AND `publishedVersion` = 1
  AND JSON_EXTRACT(`draftJson`, '$.tools') = JSON_ARRAY('listMyTasks', 'searchWorkflows')
  AND `draftJson` = `publishedJson`;
