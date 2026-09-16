import pytest
import os
from dotenv import load_dotenv
from common.common_api import CommonApi

load_dotenv()


@pytest.fixture(scope="session")
def base_url():
    return os.getenv("BASE_URL", "http://localhost:8080")


@pytest.fixture(scope="session")
def api_version():
    return os.getenv("API_VERSION", "/api/v1")


@pytest.fixture(scope="session")
def auth_credentials():
    return {"username": os.getenv("USERNAME"), "password": os.getenv("PASSWORD")}


@pytest.fixture(scope="session")
def common_api(base_url):
    """共享公共 API 客户端（Layer 1）。
    模块测试可改用 utils/user_api.py 的 UserApi（继承 CommonApi）注入业务方法。"""
    return CommonApi(base_url)
