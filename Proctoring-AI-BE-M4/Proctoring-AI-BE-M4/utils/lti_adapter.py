from pylti1p3.request import Request
from pylti1p3.cookie import CookieService
from pylti1p3.oidc_login import OIDCLogin
from pylti1p3.message_launch import MessageLaunch
from pylti1p3.redirect import Redirect
from typing import Dict, Any, Optional, Union

class FastAPIRequest(Request):
    """
    Adapter to make FastAPI Request object look like what pylti1.3 expects.
    """
    def __init__(self, method: str, url: str, cookies: Dict[str, Any], session: Dict[str, Any], params: Dict[str, Any], data: Dict[str, Any]):
        self._method = method
        self._url = url
        self._cookies = cookies
        self._session = session
        self._params = params
        self._data = data

    @property
    def method(self):
        return self._method

    @property
    def url(self):
        return self._url
        
    @property
    def base_url(self):
        return self._url.split('?')[0]

    @property
    def cookies(self):
        return self._cookies

    @property
    def session(self):
        return self._session

    @property
    def params(self):
        return self._params
        
    @property
    def args(self):
        return self._params

    @property
    def form(self):
        return self._data

    def get_param(self, key: str) -> str:
        if key in self._params:
            return str(self._params[key])
        if key in self._data:
            return str(self._data[key])
        return ""
        
    def is_secure(self):
        return self._url.startswith('https')


class FastAPICookieService(CookieService):
    def __init__(self, request_cookies: Dict[str, str]):
        self._request_cookies = request_cookies
        self._cookies_to_set = {}

    def get_cookie(self, name: str) -> Optional[str]:
        return self._request_cookies.get(name)

    def set_cookie(self, name: str, value: Union[str, int], exp: Optional[int] = 3600):
        self._cookies_to_set[name] = str(value)

    def get_cookies_to_set(self):
        return self._cookies_to_set


class FastAPIRedirect(Redirect):
    def __init__(self, location: str):
        self._location = location

    def do_redirect(self):
        return self

    def do_js_redirect(self):
        return self

    def set_redirect_url(self, location: str):
        self._location = location

    def get_redirect_url(self) -> str:
        return self._location

    @property
    def location(self):
        return self._location


class FastAPIOIDCLogin(OIDCLogin):
    def get_redirect(self, url: str) -> FastAPIRedirect:
        return FastAPIRedirect(url)

    def get_response(self, html: str) -> str:
        return html


class FastAPIMessageLaunch(MessageLaunch):
    def _get_request_param(self, key: str) -> str:
        val = self._request.get_param(key)
        return str(val) if val is not None else ""
