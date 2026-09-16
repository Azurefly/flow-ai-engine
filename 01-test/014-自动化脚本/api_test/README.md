# 接口自动化测试框架

## 架构：两层 API

- **公共 API（Layer 1，共享）**：`common/common_api.py` 的 `CommonApi`，封装发送请求、获取结果、JSON 比对等通用操作，跨模块复用。
- **用户级 API（Layer 2，可选）**：`utils/user_api.py` 的 `UserApi(CommonApi)`，承载业务自定义方法，由生成技能按需创建。
- **测试用例**：`tests/test_*.py`，优先调用公共 API，业务流程调用用户级 API。

## 只读约束（重要）

- `common/common_api.py` 为公共 API，**测试用例与 UserApi 子类只能调用，禁止修改本文件内容**。
- 生成器输出的测试脚本必须优先调用本类方法（`send_request` / `assert_json_*` 等），**禁止重复实现等价的请求/断言逻辑**（禁止裸 `assert`、禁止重新封装 `requests`）。
- 业务流程只能在 `utils/user_api.py` 的 `UserApi(CommonApi)` 中扩展，**不得修改 `common/` 基类**。

## 使用说明

1. 安装依赖：`pip install -r requirements.txt`
2. 配置环境变量：复制 `.env.example` 为 `.env`
3. 运行测试：`pytest tests/`
4. 生成报告：`pytest tests/ --alluredir=reports/allure-results`

## 公共 API 方法清单（CommonApi）

> 以下方法均定义在 `common/common_api.py`。所有方法已带完整中文 docstring（入参/返回/说明），可用 `help(CommonApi.方法名)` 或 IDE 悬停查看。**只读使用，禁止修改实现**。

### 请求配置

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `__init__(base_url, timeout=30)` | `base_url: str` 基础地址；`timeout: int` 超时秒数 | None | 初始化实例，创建 requests.Session，末尾 '/' 自动去除 |
| `set_headers(headers)` | `headers: Dict[str,str]` 请求头字典 | None | 设置会话级默认请求头，对所有后续请求生效 |
| `set_auth_token(token)` | `token: str` 鉴权令牌 | None | 设置 Bearer Token 鉴权头（Authorization: Bearer {token}） |
| `set_timeout(timeout)` | `timeout: int` 超时秒数 | None | 设置单次请求超时时间 |

### 发送请求

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `send_request(method, path, params=None, json=None, data=None, headers=None, files=None)` | `method: str` HTTP 方法；`path: str` 路径（建议 '/' 开头）；`params/json/data/headers/files` 见 docstring | `requests.Response` | 发送 HTTP 请求并记录到 last_response；所有快捷方法均委托本方法 |
| `get(path, params=None)` | `path: str`；`params: Dict` 查询参数 | `requests.Response` | GET 请求快捷方法 |
| `post(path, json=None)` | `path: str`；`json: Dict` 请求体 | `requests.Response` | POST 请求快捷方法 |
| `put(path, json=None)` | `path: str`；`json: Dict` 请求体 | `requests.Response` | PUT 请求快捷方法 |
| `delete(path)` | `path: str` | `requests.Response` | DELETE 请求快捷方法 |
| `patch(path, json=None)` | `path: str`；`json: Dict` 请求体 | `requests.Response` | PATCH 请求快捷方法 |

### 获取结果

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `get_status_code()` | 无 | `int` | 最近一次响应的 HTTP 状态码 |
| `get_response_body()` | 无 | `str` | 最近一次响应的原始文本 |
| `get_json()` | 无 | `Any`（通常 dict/list） | 将最近一次响应体解析为 JSON |
| `get_response_header(name)` | `name: str` 响应头名称（不区分大小写） | `str` | 指定响应头值；不存在返回 '' |
| `get_response_time()` | 无 | `float` | 最近一次请求耗时（毫秒，保留两位小数） |
| `get_json_path(path)` | `path: str` 点号路径，如 'data.user.id' | `Any` | 按点号路径从响应 JSON 取值 |

### 断言

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `assert_status_code(expected)` | `expected: int` 期望状态码 | None | 断言状态码等于期望值 |
| `assert_json_equal(expected)` | `expected: Any` 期望 JSON | None | 断言响应 JSON 全等（严格匹配，不允许额外字段） |
| `assert_json_contains(expected, path=None)` | `expected: Any` 子集；`path: str` 可选先取子节点 | None | 断言响应 JSON 包含期望子集（柔性匹配，允许额外字段） |
| `assert_json_path(path, expected)` | `path: str` 路径；`expected: Any` 期望值 | None | 断言响应 JSON 指定路径的值等于期望 |
| `assert_response_header(name, value)` | `name: str`；`value: str` | None | 断言指定响应头等于期望值 |
| `assert_response_time(max_ms)` | `max_ms: float` 最大毫秒 | None | 断言响应耗时不超过 max_ms 毫秒 |
| `assert_field_value(field, expected)` | `field: str` 字段路径；`expected: Any` 期望值 | None | 断言指定字段值等于期望（等价于 assert_json_path，语义强调字段） |

## 典型用法

```python
from common.common_api import CommonApi

api = CommonApi(base_url="https://api.example.com", timeout=30)
api.set_auth_token("your-token-here")

# 注册用户
api.post("/users", json={"username": "testuser", "password": "Pass1234"})
api.assert_status_code(201)
api.assert_json_contains({"code": 0, "message": "success"})
api.assert_json_path("data.username", "testuser")

# 查询用户
api.get("/users/1001")
api.assert_status_code(200)
api.assert_response_time(500)
```
