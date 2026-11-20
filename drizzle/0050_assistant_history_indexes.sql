ALTER TABLE `assistant_session`
  ADD INDEX `assistant_history_owner_idx` (`ownerUserId`,`trial`,`updatedAt` DESC,`id`),
  ADD INDEX `assistant_history_project_idx` (`ownerUserId`,`trial`,`projectId`,`updatedAt` DESC,`id`),
  ADD INDEX `assistant_history_agent_idx` (`ownerUserId`,`trial`,`agentId`,`updatedAt` DESC,`id`),
  ADD INDEX `assistant_history_project_agent_idx` (`ownerUserId`,`trial`,`projectId`,`agentId`,`updatedAt` DESC,`id`),
  DROP INDEX `assistant_session_owner_idx`,
  ALGORITHM=INPLACE, LOCK=NONE;
