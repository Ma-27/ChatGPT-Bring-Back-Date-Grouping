"""
这个脚本用于从本机 Chrome 历史记录中提取最近访问的 ChatGPT 对话 URL。
这样调试脚本可以直接进入真实对话页，而不是停留在首页。
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
from pathlib import Path


def main() -> None:
    """输出最近访问的 ChatGPT 对话地址。"""

    history_path = (
        Path.home()
        / "Library"
        / "Application Support"
        / "Google"
        / "Chrome"
        / "Default"
        / "History"
    )
    with tempfile.TemporaryDirectory(prefix="chatgpt-history-") as temp_dir:
        temp_history_path = Path(temp_dir) / "History"
        shutil.copy2(history_path, temp_history_path)
        connection = sqlite3.connect(temp_history_path)
        try:
            cursor = connection.execute(
                """
                select url
                from urls
                where url like 'https://chatgpt.com/c/%'
                order by last_visit_time desc
                limit 1
                """
            )
            row = cursor.fetchone()
        finally:
            connection.close()

    if not row or not row[0]:
        raise SystemExit("未找到最近访问的 ChatGPT 对话 URL。")

    print(row[0])


if __name__ == "__main__":
    main()
