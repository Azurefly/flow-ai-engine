ALTER TABLE `project_service_endpoint`
  ADD `targetEnvironment` enum('unclassified','development','test','staging','production') NOT NULL DEFAULT 'unclassified';
