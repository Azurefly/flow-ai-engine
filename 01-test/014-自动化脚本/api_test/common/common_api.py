"""公共 API（Layer 1）：基于 requests 封装的通用接口操作库。

本文件由 api-automation-testcase-generator 技能首次运行时从 templates/api_test/ 拷贝至
输出根目录的 common/common_api.py，跨模块共享。

只读约束（重要）：
- 本文件为公共 API，测试用例/用户级 API（UserApi）只能调用，禁止修改本文件内容。
- 生成器输出的测试脚本必须优先调用本类方法（send_request / assert_json_* 等），
  禁止重复实现等价的请求/断言逻辑（禁止裸 assert、禁止重新封装 requests）。
- 业务流程可在 utils/user_api.py 的 UserApi(CommonApi) 中扩展，但不得修改本基类。

测试用例使用示例：
    api = CommonApi(base_url="https://api.example.com")
    api.set_auth_token("xxx")
    api.post("/users", json={"name": "test"})
    api.assert_status_code(201)
    api.assert_json_contains({"code": 0})
    api.assert_json_path("data.id", 1001)
"""
import requests
from typing import Any, Dict, Optional


def _resolve_path(data: Any, path: str) -> Any:
    """按点号路径从嵌套 dict 中取值。

    Args:
        data: 待取值的数据，必须是 dict 或可逐层下标的对象。
        path: 点号分隔的路径字符串，例如 'data.user.id'。

    Returns:
        路径指向的值。

    Raises:
        KeyError: 路径中间某段不是 dict，或键不存在时抛出。
    """
    cur = data
    for seg in path.split('.'):
        if seg == '':
            continue
        if not isinstance(cur, dict):
            raise KeyError(f"路径 {path!r} 在 '{seg}' 处不是 dict：{cur!r}")
        cur = cur[seg]
    return cur


def _contains(actual: Any, expected: Any) -> bool:
    """子集包含判断：expected 的每个键/元素都在 actual 中递归相等。

    用于柔性断言（只校验关心的字段，允许响应包含额外字段）。

    Args:
        actual: 实际响应数据（dict/list/标量）。
        expected: 期望的子集数据，结构必须与 actual 对应位置匹配。

    Returns:
        True 表示 actual 完整包含 expected；False 表示不包含。
    """
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return False
        return all(k in actual and _contains(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        if not isinstance(actual, list):
            return False
        if len(expected) > len(actual):
            return False
        return all(any(_contains(a, e) for a in actual) for e in expected)
    return actual == expected


class CommonApi:
    """公共 API 基类（Layer 1）。

    持有 requests.Session 与最近一次响应（last_response），所有 get_*/assert_* 操作
    均基于 last_response 进行。测试用例应优先调用本类方法，禁止重复封装请求/断言。

    只读约束：本类为公共 API，测试脚本与 UserApi 子类只能调用，禁止修改本类源码。
    """

    def __init__(self, base_url: str, timeout: int = 30):
        """初始化公共 API 实例。

        Args:
            base_url: 被测服务的基础地址，例如 'https://api.example.com'。
                末尾的 '/' 会被自动去除。
            timeout: 单次请求超时时间（秒），默认 30。
        """
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.session = requests.Session()
        self.last_response: Optional[requests.Response] = None

    # ===== 请求配置 =====
    def set_headers(self, headers: Dict[str, str]) -> None:
        """设置会话级默认请求头（对所有后续请求生效）。

        Args:
            headers: 请求头字典，例如 {'Content-Type': 'application/json'}。
                键已存在则覆盖，不存在则新增。

        Returns:
            None
        """
        self.session.headers.update(headers)

    def set_auth_token(self, token: str) -> None:
        """设置 Bearer Token 鉴权头（Authorization: Bearer {token}）。

        Args:
            token: 鉴权令牌字符串，无需携带 'Bearer ' 前缀。

        Returns:
            None
        """
        self.session.headers.update({"Authorization": f"Bearer {token}"})

    def set_timeout(self, timeout: int) -> None:
        """设置单次请求超时时间（秒）。

        Args:
            timeout: 超时秒数。

        Returns:
            None
        """
        self.timeout = timeout

    # ===== 发送请求 =====
    def send_request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
        data: Optional[Any] = None,
        headers: Optional[Dict[str, str]] = None,
        files: Optional[Dict[str, Any]] = None,
    ) -> requests.Response:
        """发送 HTTP 请求并记录到 last_response。

        所有 get/post/put/delete/patch 快捷方法均委托本方法。url 由 base_url 拼接 path 得到。

        Args:
            method: HTTP 方法，例如 'GET'/'POST'/'PUT'/'DELETE'/'PATCH'（大小写不敏感）。
            path: 接口路径，建议以 '/' 开头（如 '/users'）；不以 '/' 开头时自动补 '/'。
            params: URL 查询参数字典，例如 {'page': 1, 'size': 20}。默认 None。
            json: 请求体 JSON（dict），requests 会自动序列化并设置 Content-Type。默认 None。
            data: 请求体（表单/原始字符串/bytes），与 json 二选一。默认 None。
            headers: 本次请求额外覆盖的请求头。默认 None。
            files: multipart 上传文件字典。默认 None。

        Returns:
            requests.Response: 本次响应对象，同时存入 self.last_response。
        """
        url = f"{self.base_url}{path}" if path.startswith('/') else f"{self.base_url}/{path}"
        if headers:
            self.set_headers(headers)
        resp = self.session.request(
            method.upper(), url, params=params, json=json, data=data,
            files=files, timeout=self.timeout,
        )
        self.last_response = resp
        return resp

    def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> requests.Response:
        """发送 GET 请求（send_request 的快捷方法）。

        Args:
            path: 接口路径，建议以 '/' 开头。
            params: URL 查询参数字典。默认 None。

        Returns:
            requests.Response: 本次响应对象。
        """
        return self.send_request("GET", path, params=params)

    def post(self, path: str, json: Optional[Dict[str, Any]] = None) -> requests.Response:
        """发送 POST 请求（send_request 的快捷方法）。

        Args:
            path: 接口路径，建议以 '/' 开头。
            json: 请求体 JSON（dict）。默认 None。

        Returns:
            requests.Response: 本次响应对象。
        """
        return self.send_request("POST", path, json=json)

    def put(self, path: str, json: Optional[Dict[str, Any]] = None) -> requests.Response:
        """发送 PUT 请求（send_request 的快捷方法）。

        Args:
            path: 接口路径，建议以 '/' 开头。
            json: 请求体 JSON（dict）。默认 None。

        Returns:
            requests.Response: 本次响应对象。
        """
        return self.send_request("PUT", path, json=json)

    def delete(self, path: str) -> requests.Response:
        """发送 DELETE 请求（send_request 的快捷方法）。

        Args:
            path: 接口路径，建议以 '/' 开头。

        Returns:
            requests.Response: 本次响应对象。
        """
        return self.send_request("DELETE", path)

    def patch(self, path: str, json: Optional[Dict[str, Any]] = None) -> requests.Response:
        """发送 PATCH 请求（send_request 的快捷方法）。

        Args:
            path: 接口路径，建议以 '/' 开头。
            json: 请求体 JSON（dict）。默认 None。

        Returns:
            requests.Response: 本次响应对象。
        """
        return self.send_request("PATCH", path, json=json)

    # ===== 获取结果 =====
    def get_status_code(self) -> int:
        """获取最近一次响应的 HTTP 状态码。

        Returns:
            int: 状态码，例如 200/201/404。

        Raises:
            AssertionError: 尚未发送任何请求（last_response 为 None）。
        """
        assert self.last_response is not None, "无可用响应：请先调用 send_request"
        return self.last_response.status_code

    def get_response_body(self) -> str:
        """获取最近一次响应的原始文本。

        Returns:
            str: 响应体文本（response.text）。

        Raises:
            AssertionError: 尚未发送任何请求。
        """
        assert self.last_response is not None, "无可用响应：请先调用 send_request"
        return self.last_response.text

    def get_json(self) -> Any:
        """将最近一次响应体解析为 JSON 并返回。

        Returns:
            Any: 解析后的 JSON 数据（通常是 dict 或 list）。

        Raises:
            AssertionError: 尚未发送任何请求。
            requests.JSONDecodeError: 响应体不是合法 JSON。
        """
        assert self.last_response is not None, "无可用响应：请先调用 send_request"
        return self.last_response.json()

    def get_response_header(self, name: str) -> str:
        """获取最近一次响应的指定响应头。

        Args:
            name: 响应头名称（不区分大小写），例如 'Content-Type'。

        Returns:
            str: 响应头值；不存在时返回空字符串 ''。
        """
        assert self.last_response is not None, "无可用响应：请先调用 send_request"
        return self.last_response.headers.get(name, '')

    def get_response_time(self) -> float:
        """获取最近一次请求的耗时（毫秒）。

        Returns:
            float: 响应耗时，单位毫秒，保留两位小数。
        """
        assert self.last_response is not None, "无可用响应：请先调用 send_request"
        return round(self.last_response.elapsed.total_seconds() * 1000, 2)

    def get_json_path(self, path: str) -> Any:
        """按点号路径从最近一次响应 JSON 中取值。

        Args:
            path: 点号分隔的路径，例如 'data.user.id'。

        Returns:
            Any: 路径指向的值。

        Raises:
            KeyError: 路径中间某段不是 dict 或键不存在。
        """
        return _resolve_path(self.get_json(), path)

    # ===== 断言 =====
    def assert_status_code(self, expected: int) -> None:
        """断言最近一次响应的状态码等于期望值。

        Args:
            expected: 期望的状态码，例如 200。

        Raises:
            AssertionError: 实际状态码与期望不一致。
        """
        actual = self.get_status_code()
        assert actual == expected, f"状态码断言失败: 期望 {expected}, 实际 {actual}"

    def assert_json_equal(self, expected: Any) -> None:
        """断言最近一次响应 JSON 与期望值全等（严格匹配，不允许额外字段）。

        Args:
            expected: 期望的 JSON 数据（dict/list/标量）。

        Raises:
            AssertionError: 实际 JSON 与期望不全等。
        """
        actual = self.get_json()
        assert actual == expected, f"JSON 全等断言失败: 期望 {expected}, 实际 {actual}"

    def assert_json_contains(self, expected: Any, path: Optional[str] = None) -> None:
        """断言最近一次响应 JSON 包含期望的子集（柔性匹配，允许响应有额外字段）。

        递归比较：expected 的每个键/元素都在 actual 中存在且相等。

        Args:
            expected: 期望的子集数据。
            path: 可选，先按点号路径从响应 JSON 中取子节点再断言。默认 None 表示对整棵 JSON 树断言。

        Raises:
            AssertionError: actual 不包含 expected。
        """
        actual = self.get_json_path(path) if path else self.get_json()
        assert _contains(actual, expected), f"JSON 包含断言失败: 期望包含 {expected}, 实际 {actual}"

    def assert_json_path(self, path: str, expected: Any) -> None:
        """断言最近一次响应 JSON 中指定路径的值等于期望值。

        Args:
            path: 点号路径，例如 'data.user.id'。
            expected: 期望值。

        Raises:
            AssertionError: 路径取值与期望不一致。
            KeyError: 路径不存在。
        """
        actual = self.get_json_path(path)
        assert actual == expected, f"JSON 路径断言失败: {path} 期望 {expected}, 实际 {actual}"

    def assert_response_header(self, name: str, value: str) -> None:
        """断言最近一次响应的指定响应头等于期望值。

        Args:
            name: 响应头名称（不区分大小写）。
            value: 期望的响应头值。

        Raises:
            AssertionError: 实际响应头值与期望不一致。
        """
        actual = self.get_response_header(name)
        assert actual == value, f"响应头断言失败: {name} 期望 {value}, 实际 {actual}"

    def assert_response_time(self, max_ms: float) -> None:
        """断言最近一次请求耗时不超过 max_ms 毫秒。

        Args:
            max_ms: 允许的最大耗时（毫秒）。

        Raises:
            AssertionError: 实际耗时超过 max_ms。
        """
        actual = self.get_response_time()
        assert actual <= max_ms, f"响应时间断言失败: 期望 <= {max_ms}ms, 实际 {actual}ms"

    def assert_field_value(self, field: str, expected: Any) -> None:
        """断言最近一次响应 JSON 中指定字段的值等于期望值。

        与 assert_json_path 等价，语义上更强调"字段值"校验。

        Args:
            field: 字段路径（点号分隔），例如 'data.username'。
            expected: 期望的字段值。

        Raises:
            AssertionError: 字段实际值与期望不一致。
            KeyError: 字段路径不存在。
        """
        actual = self.get_json_path(field)
        assert actual == expected, f"字段断言失败: {field} 期望 {expected}, 实际 {actual}"
