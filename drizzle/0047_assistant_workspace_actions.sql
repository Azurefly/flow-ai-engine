CREATE TABLE `assistant_action_receipt` (
	`id` varchar(36) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`message` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assistant_action_receipt_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
INSERT INTO assistant_agent (id,draftJson,draftVersion,publishedJson,publishedVersion)
SELECT 'workspace-assistant', seed.config, 1, seed.config, 1 FROM (
  SELECT JSON_OBJECT(
    'name','业务工作台助手',
    'greeting','我可以查询待办和业务统计、生成流程画布，也可以按你的权限办理业务。你想处理什么？',
    'instructions','用中文简洁回答。查询和统计应指明范围、时间与数量，保留工具返回的下限。生成画布时先了解目标、办理人和分支，再展示草稿。执行变更前逐项给出操作预览。',
    'model','',
    'tools',JSON_ARRAY('listMyTasks','listMyCompletedTasks','searchWorkflows','createWorkflowDraft','workspaceRead','workspaceWrite'),
    'enabled',TRUE,'roles',JSON_ARRAY('user','admin'),'projectIds',JSON_ARRAY()
  ) AS config
) seed WHERE NOT EXISTS (SELECT 1 FROM assistant_agent WHERE id='workspace-assistant');
