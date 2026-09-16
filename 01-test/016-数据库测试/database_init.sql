-- =============================================
-- 数据库建库与初始化脚本
-- 项目名称: AiFlowGraph AI流程引擎系统
-- 生成日期: 2026-09-15
-- 字符集: utf8mb4 / utf8mb4_unicode_ci
-- =============================================

CREATE DATABASE IF NOT EXISTS `aiflow` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `aiflow`;

-- 1. 用户与认证表
CREATE TABLE IF NOT EXISTS `user` (
  `id` int AUTO_INCREMENT NOT NULL,
  `username` varchar(64) NOT NULL,
  `password` varchar(255) NOT NULL,
  `name` varchar(160),
  `email` varchar(255),
  `role` enum('user','admin') NOT NULL DEFAULT 'user',
  `status` enum('active','disabled') NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_username_unique` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户账号表';

-- 2. 系统权限表
CREATE TABLE IF NOT EXISTS `permission` (
  `id` int AUTO_INCREMENT NOT NULL,
  `code` varchar(96) NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `permission_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统权限定义表';

-- 3. IAM 角色表
CREATE TABLE IF NOT EXISTS `iam_role` (
  `id` int AUTO_INCREMENT NOT NULL,
  `code` varchar(64) NOT NULL,
  `name` varchar(120) NOT NULL,
  `description` text,
  `scope` enum('system','workflow') NOT NULL,
  `isSystem` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `iam_role_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色定义表';

-- 4. 角色权限关联表
CREATE TABLE IF NOT EXISTS `role_permission` (
  `id` int AUTO_INCREMENT NOT NULL,
  `roleId` int NOT NULL,
  `permissionId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_permission_unique_idx` (`roleId`,`permissionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色与权限关联表';

-- 5. 角色授权表
CREATE TABLE IF NOT EXISTS `role_assignment` (
  `id` varchar(36) NOT NULL,
  `userId` int NOT NULL,
  `roleId` int NOT NULL,
  `scopeType` enum('system','workflow') NOT NULL,
  `scopeId` varchar(36),
  `effectiveFrom` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiresAt` timestamp NULL,
  `revokedAt` timestamp NULL,
  `grantedByUserId` int,
  `revokedByUserId` int,
  `note` varchar(320),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `role_assignment_user_idx` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户角色授权记录表';

-- 6. 业务空间项目表
CREATE TABLE IF NOT EXISTS `project` (
  `id` varchar(36) NOT NULL,
  `code` varchar(64) NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` text,
  `domainId` varchar(36),
  `ownerUserId` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `project_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务项目空间表';

-- 7. 流程定义主表
CREATE TABLE IF NOT EXISTS `workflow` (
  `id` varchar(36) NOT NULL,
  `projectId` varchar(36) NOT NULL,
  `processCode` varchar(64) NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` text,
  `flowType` enum('state','control','data') NOT NULL DEFAULT 'state',
  `status` enum('draft','published') NOT NULL DEFAULT 'draft',
  `auditStatus` enum('init','approved','rejected') NOT NULL DEFAULT 'init',
  `definitionVersion` int NOT NULL DEFAULT 1,
  `definitionJson` json,
  `folderId` varchar(36),
  `dataSourceId` varchar(36),
  `publishedAt` timestamp NULL,
  `unpublishedAt` timestamp NULL,
  `archivedAt` timestamp NULL,
  `archivedByUserId` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `workflow_project_code_idx` (`projectId`,`processCode`),
  KEY `workflow_project_idx` (`projectId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流程定义表';

-- 8. 流程运行实例表
CREATE TABLE IF NOT EXISTS `workflow_run` (
  `id` varchar(36) NOT NULL,
  `workflowId` varchar(36) NOT NULL,
  `definitionVersion` int NOT NULL,
  `triggeredByUserId` int,
  `status` enum('queued','running','waiting','blocked','success','failed','cancelled','terminated') NOT NULL DEFAULT 'queued',
  `inputJson` json,
  `outputJson` json,
  `error` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finishedAt` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `workflow_run_workflow_idx` (`workflowId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流程运行实例表';

-- 9. 人工任务表
CREATE TABLE IF NOT EXISTS `workflow_task` (
  `id` varchar(36) NOT NULL,
  `runId` varchar(36) NOT NULL,
  `workflowId` varchar(36) NOT NULL,
  `nodeId` varchar(64) NOT NULL,
  `title` varchar(255) NOT NULL,
  `status` enum('pending','claimed','completed','cancelled') NOT NULL DEFAULT 'pending',
  `assigneeUserId` int NULL,
  `signMode` enum('orSignFor','andSignFor','sequentialSignFor') NOT NULL DEFAULT 'orSignFor',
  `resultJson` json NULL,
  `claimedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `workflow_task_run_idx` (`runId`),
  KEY `workflow_task_assignee_idx` (`assigneeUserId`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批与人工任务表';

-- 10. 组织机构表
CREATE TABLE IF NOT EXISTS `organization_unit` (
  `id` varchar(36) NOT NULL,
  `code` varchar(64) NOT NULL,
  `name` varchar(160) NOT NULL,
  `parentUnitId` varchar(36) NULL,
  `managerUserId` int NULL,
  `unitType` varchar(64) DEFAULT 'department',
  `status` enum('active','disabled') NOT NULL DEFAULT 'active',
  `sortOrder` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `org_unit_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组织架构部门表';

-- 11. 授权审计日志表
CREATE TABLE IF NOT EXISTS `authorization_audit_log` (
  `id` varchar(36) NOT NULL,
  `actorUserId` int,
  `targetUserId` int,
  `action` varchar(64) NOT NULL,
  `resourceType` varchar(64),
  `resourceId` varchar(64),
  `detailsJson` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `audit_actor_idx` (`actorUserId`),
  KEY `audit_created_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='安全与授权审计日志表';

-- =============================================
-- 初始化基础数据
-- =============================================

-- 内置角色
INSERT INTO `iam_role` (`id`, `code`, `name`, `description`, `scope`, `isSystem`) VALUES
(1, 'system_admin', '系统超级管理员', '拥有系统全部全局管理与审批配置权限', 'system', true),
(2, 'project_owner', '项目空间所有者', '拥有业务空间内所有流程的管理权限', 'system', true)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
