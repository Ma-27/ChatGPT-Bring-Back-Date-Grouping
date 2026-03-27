"""
这个脚本用于从本机 Chrome 中导出 chatgpt.com 相关 cookie，
供调试脚本在独立浏览器上下文中复用真实登录态。
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass

import browser_cookie3


@dataclass
class CookieItem:
    """Playwright 可直接消费的 cookie 结构。"""

    name: str
    value: str
    domain: str
    path: str
    expires: int
    httpOnly: bool
    secure: bool
    sameSite: str


def normalize_same_site(raw_value: str | None) -> str:
    """将浏览器库的 sameSite 值映射到 Playwright 兼容格式。"""

    mapping = {
        None: "Lax",
        "": "Lax",
        "unspecified": "Lax",
        "no_restriction": "None",
        "lax": "Lax",
        "strict": "Strict",
    }
    return mapping.get((raw_value or "").lower(), "Lax")


def build_cookie_items() -> list[dict]:
    """提取 chatgpt.com 域名下的 cookie 并转换为 JSON。"""

    cookie_jar = browser_cookie3.chrome(domain_name="chatgpt.com")
    items: list[dict] = []
    for cookie in cookie_jar:
        if "chatgpt.com" not in cookie.domain:
            continue
        items.append(
            asdict(
                CookieItem(
                    name=cookie.name,
                    value=cookie.value,
                    domain=cookie.domain,
                    path=cookie.path or "/",
                    expires=int(cookie.expires or -1),
                    httpOnly=bool(cookie._rest.get("HttpOnly")),
                    secure=bool(cookie.secure),
                    sameSite=normalize_same_site(cookie._rest.get("SameSite")),
                )
            )
        )
    return items


def main() -> None:
    """导出 cookie JSON 到标准输出。"""

    print(json.dumps(build_cookie_items(), ensure_ascii=False))


if __name__ == "__main__":
    main()
