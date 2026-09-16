#!/usr/bin/env bash
set -euo pipefail
cd /opt/flow-ai-engine/source

blockers="$(sudo docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" flow_ai_engine -N' <<'SQL'
SELECT
  (SELECT COUNT(*) FROM organization_unit WHERE managerUserId IN (SELECT id FROM users WHERE openId LIKE 'test:p0-%' OR openId LIKE 'test:p1-%') OR createdByUserId IN (SELECT id FROM users WHERE openId LIKE 'test:p0-%' OR openId LIKE 'test:p1-%'))
  + (SELECT COUNT(*) FROM organization_unit_role WHERE createdByUserId IN (SELECT id FROM users WHERE openId LIKE 'test:p0-%' OR openId LIKE 'test:p1-%'))
  + (SELECT COUNT(*) FROM work_domain WHERE createdByUserId IN (SELECT id FROM users WHERE openId LIKE 'test:p0-%' OR openId LIKE 'test:p1-%'));
SQL
)"
if [ "$blockers" != "0" ]; then
  printf 'Refusing cleanup: unexpected organization or work-domain references=%s\n' "$blockers" >&2
  exit 1
fi

sudo docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" flow_ai_engine' <<'SQL'
START TRANSACTION;
CREATE TEMPORARY TABLE cleanup_users (id INT PRIMARY KEY);
INSERT INTO cleanup_users SELECT id FROM users WHERE openId LIKE 'test:p0-%' OR openId LIKE 'test:p1-%';
CREATE TEMPORARY TABLE cleanup_users_2 (id INT PRIMARY KEY);
INSERT INTO cleanup_users_2 SELECT id FROM cleanup_users;
CREATE TEMPORARY TABLE cleanup_users_3 (id INT PRIMARY KEY);
INSERT INTO cleanup_users_3 SELECT id FROM cleanup_users;
CREATE TEMPORARY TABLE cleanup_projects (id VARCHAR(36) PRIMARY KEY);
INSERT INTO cleanup_projects SELECT id FROM flow_project WHERE ownerUserId IN (SELECT id FROM cleanup_users);
CREATE TEMPORARY TABLE cleanup_workflows (id VARCHAR(36) PRIMARY KEY);
INSERT INTO cleanup_workflows SELECT id FROM workflow WHERE projectId IN (SELECT id FROM cleanup_projects) OR ownerUserId IN (SELECT id FROM cleanup_users);
CREATE TEMPORARY TABLE cleanup_runs (id VARCHAR(36) PRIMARY KEY);
INSERT INTO cleanup_runs SELECT id FROM workflow_run WHERE workflowId IN (SELECT id FROM cleanup_workflows) OR ownerUserId IN (SELECT id FROM cleanup_users) OR triggeredByUserId IN (SELECT id FROM cleanup_users_2);

DELETE FROM workflow_run_alert WHERE runId IN (SELECT id FROM cleanup_runs) OR workflowId IN (SELECT id FROM cleanup_workflows) OR recipientUserId IN (SELECT id FROM cleanup_users);
DELETE FROM workflow_participant_state WHERE runId IN (SELECT id FROM cleanup_runs) OR workflowId IN (SELECT id FROM cleanup_workflows) OR userId IN (SELECT id FROM cleanup_users);
DELETE FROM workflow_task_group WHERE runId IN (SELECT id FROM cleanup_runs) OR workflowId IN (SELECT id FROM cleanup_workflows);
DELETE FROM workflow_task WHERE runId IN (SELECT id FROM cleanup_runs) OR workflowId IN (SELECT id FROM cleanup_workflows) OR assignedUserId IN (SELECT id FROM cleanup_users) OR claimedByUserId IN (SELECT id FROM cleanup_users_2) OR completedByUserId IN (SELECT id FROM cleanup_users_3);
DELETE FROM workflow_node_run WHERE runId IN (SELECT id FROM cleanup_runs);
DELETE FROM workflow_run WHERE id IN (SELECT id FROM cleanup_runs);
DELETE FROM workflow_version WHERE workflowId IN (SELECT id FROM cleanup_workflows) OR createdByUserId IN (SELECT id FROM cleanup_users);
DELETE FROM workflow_member WHERE workflowId IN (SELECT id FROM cleanup_workflows) OR userId IN (SELECT id FROM cleanup_users) OR grantedByUserId IN (SELECT id FROM cleanup_users_2);
DELETE FROM dataflow_run WHERE workflowId IN (SELECT id FROM cleanup_workflows) OR projectId IN (SELECT id FROM cleanup_projects) OR triggeredByUserId IN (SELECT id FROM cleanup_users);
DELETE FROM dataflow_schedule WHERE workflowId IN (SELECT id FROM cleanup_workflows) OR projectId IN (SELECT id FROM cleanup_projects) OR createdByUserId IN (SELECT id FROM cleanup_users);
DELETE FROM workflow WHERE id IN (SELECT id FROM cleanup_workflows);
DELETE FROM workflow_folder WHERE projectId IN (SELECT id FROM cleanup_projects) OR createdByUserId IN (SELECT id FROM cleanup_users);

DELETE FROM data_asset WHERE projectId IN (SELECT id FROM cleanup_projects) OR createdByUserId IN (SELECT id FROM cleanup_users);
DELETE FROM data_source WHERE projectId IN (SELECT id FROM cleanup_projects) OR createdByUserId IN (SELECT id FROM cleanup_users);
DELETE FROM data_tag WHERE projectId IN (SELECT id FROM cleanup_projects) OR createdByUserId IN (SELECT id FROM cleanup_users);
DELETE FROM data_udf WHERE projectId IN (SELECT id FROM cleanup_projects) OR createdByUserId IN (SELECT id FROM cleanup_users);
DELETE FROM project_plugin WHERE projectId IN (SELECT id FROM cleanup_projects) OR createdByUserId IN (SELECT id FROM cleanup_users);
DELETE FROM flow_project_member WHERE projectId IN (SELECT id FROM cleanup_projects) OR userId IN (SELECT id FROM cleanup_users) OR grantedByUserId IN (SELECT id FROM cleanup_users_2);
DELETE FROM flow_project WHERE id IN (SELECT id FROM cleanup_projects);

UPDATE system_setting SET updatedByUserId=NULL WHERE updatedByUserId IN (SELECT id FROM cleanup_users);
DELETE FROM workflow_node_template WHERE ownerUserId IN (SELECT id FROM cleanup_users);
DELETE FROM workflow_subflow WHERE ownerUserId IN (SELECT id FROM cleanup_users);
DELETE FROM organization_membership WHERE userId IN (SELECT id FROM cleanup_users);
DELETE FROM role_assignment WHERE userId IN (SELECT id FROM cleanup_users) OR grantedByUserId IN (SELECT id FROM cleanup_users_2) OR revokedByUserId IN (SELECT id FROM cleanup_users_3);
DELETE FROM auth_session WHERE userId IN (SELECT id FROM cleanup_users);
DELETE FROM authorization_audit_log WHERE actorUserId IN (SELECT id FROM cleanup_users) OR targetUserId IN (SELECT id FROM cleanup_users_2);
DELETE FROM users WHERE id IN (SELECT id FROM cleanup_users);
COMMIT;
SQL

bash /tmp/audit-test-residue.sh
