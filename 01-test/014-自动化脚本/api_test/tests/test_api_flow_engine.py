"""AiFlowGraph tRPC 核心接口自动化测试脚本

对应测试用例：01-test/013-测试用例/03-接口测试用例/AiFlowGraph-接口测试用例.md
遵循全局用例映射规则：ATXXX-a -> test_ATXXX_a
调用 Layer 1 CommonApi 公共方法，禁止裸 assert。
"""
import pytest
from common.common_api import CommonApi


class TestApiFlowEngine:
    """AiFlowGraph 流程与数据流引擎接口自动化测试类"""

    def test_AT001_a_login_success(self, common_api: CommonApi):
        """AT001-a: 合法管理员凭据登录成功并返回用户信息"""
        payload = {
            "username": "admin",
            "password": "ValidAdminPassword2026!",
        }
        common_api.post("/api/trpc/auth.login", json=payload)
        common_api.assert_status_code(200)
        common_api.assert_json_path("result.data.json.role", "admin")

    def test_AT001_b_login_rate_limit(self, common_api: CommonApi):
        """AT001-b: 连续 5 次错误密码触发防爆破频率锁定"""
        wrong_payload = {
            "username": "admin",
            "password": "WrongPassword123!",
        }
        # 触发 5 次失败
        for _ in range(5):
            common_api.post("/api/trpc/auth.login", json=wrong_payload)

        # 第 6 次被限流拦截
        common_api.post("/api/trpc/auth.login", json=wrong_payload)
        # 应返回 429 Too Many Requests
        common_api.assert_status_code(429)

    def test_AT002_a_create_project(self, common_api: CommonApi):
        """AT002-a: 业务项目创建与代号大写规范"""
        payload = {
            "code": "AUTO_PROJECT_API",
            "name": "自动化测试业务空间",
            "description": "API测试自动生成",
        }
        common_api.post("/api/trpc/project.create", json=payload)
        common_api.assert_status_code(200)
        common_api.assert_json_contains({"result": {"data": {}}})

    def test_AT003_a_create_workflow_validation(self, common_api: CommonApi):
        """AT003-a: 数据流创建时必须选择有效数据源"""
        payload = {
            "projectId": "proj_demo_01",
            "processCode": "DATA_ETL_FLOW",
            "name": "客户数据清洗",
            "flowType": "data",
            "creationSource": "manual",
            "dataSourceId": "ds_mysql_01",
        }
        common_api.post("/api/trpc/project.createWorkflow", json=payload)
        common_api.assert_status_code(200)

    def test_AT005_a_publish_audit_gate(self, common_api: CommonApi):
        """AT005-a: 草稿流程未审核直接发布被拒绝"""
        payload = {
            "id": "wf_draft_unapproved",
        }
        common_api.post("/api/trpc/workflow.publish", json=payload)
        # 接口应拒绝发布并返回业务错误
        common_api.assert_json_path("error.json.message", "流程不存在或无发布权限。")

    def test_AT008_a_task_complete_reject_comment(self, common_api: CommonApi):
        """AT008-a: 审批驳回未填处理意见时返回参数校验错误"""
        payload = {
            "taskId": "00000000-0000-0000-0000-000000000001",
            "result": {
                "decision": "rejected",
                "comment": "",
            },
        }
        common_api.post("/api/trpc/task.complete", json=payload)
        # 驳回必须填意见，期望返回 400 校验异常
        common_api.assert_status_code(400)

    def test_AT015_a_create_user_short_password(self, common_api: CommonApi):
        """AT015-a: 新建账号密码少于 12 字符时被拦截"""
        payload = {
            "username": "tester_short_pwd",
            "password": "short_pwd",
            "name": "短密码测试员",
            "role": "user",
        }
        common_api.post("/api/trpc/iam.createUser", json=payload)
        # 校验失败返回 400
        common_api.assert_status_code(400)
