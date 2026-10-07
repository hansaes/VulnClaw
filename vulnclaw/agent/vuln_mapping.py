"""Web hunting: function→vuln-class mapping + opening checklist (P0-2/3).

Research findings:
- RedAmon SSRF (8 tool calls, 4 min): the win came from *function semantics*
  ("this form fetches a URL → SSRF"), not from scanning. Encode the mapping.
- Web opening 5-item checklist (hossam77i, cross-validated): deterministic
  first 5 minutes, structured output, THEN the LLM decides what to test.
"""

from __future__ import annotations

import re


# ── Function → vulnerability class mapping ──────────────────────
# (regex on parameter/endpoint name, vuln class, priority, note)

FUNCTION_VULN_MAP: list[tuple[str, str, int, str]] = [
    (r"(url|fetch|webhook|image_proxy|pdf|render|preview)[=_]", "ssrf", 1,
     "取 URL/生成 PDF/图片代理功能 → 优先 SSRF"),
    (r"\?(id|user|uid|account|order|invoice)\=\d+", "idor", 1,
     "数字型资源 ID 参数 → 优先 IDOR（双账号对照）"),
    (r"\?(q|query|search|keyword|name)=.*", "xss", 2,
     "搜索/回显型参数 → 优先反射 XSS（先确认输出上下文）"),
    (r"\?(file|page|path|template|include|load)=", "lfi", 2,
     "文件/路径参数 → 优先 LFI/路径穿越"),
    (r"\?(redirect|next|url|return|continue)=https?%3A", "open-redirect", 3,
     "跳转参数 → 优先开放重定向（再看能否链 OAuth）"),
    (r"(login|signin|auth)", "auth", 1,
     "登录功能 → 万能密码/默认凭证/爆破防护/重置逻辑"),
    (r"(upload|avatar|attachment)", "file-upload", 2,
     "上传功能 → 类型绕过/解析漏洞/存储型 XSS"),
    (r"/graphql", "graphql", 2,
     "GraphQL → introspection + BOLA/BFLA"),
    (r"/api/", "api", 2,
     "API 端点 → 按 IDOR/越权/BOLA 逐个过"),
]


def map_function_to_vuln(url_or_param: str) -> list[dict]:
    """Return ranked vuln classes for a URL/parameter string."""
    hits = []
    for pattern, vuln, priority, note in FUNCTION_VULN_MAP:
        if re.search(pattern, url_or_param, re.IGNORECASE):
            hits.append({"vuln": vuln, "priority": priority, "note": note,
                         "matched": pattern})
    hits.sort(key=lambda h: h["priority"])
    return hits


# ── Web opening 5-item checklist ────────────────────────────────

OPENING_CHECKLIST: list[dict] = [
    {
        "id": "source",
        "title": "页面源码",
        "checks": ["HTML 注释", "隐藏表单字段", "外链 JS 文件列表", "内联 JS 中的 API 路径/密钥"],
    },
    {
        "id": "robots",
        "title": "robots.txt / sitemap.xml",
        "checks": ["Disallow 路径逐个访问", "sitemap 列出隐藏端点"],
    },
    {
        "id": "cookies",
        "title": "Cookie 检查",
        "checks": [
            "base64 → 解码看内容",
            "JWT → 看 alg（none?）/ kid（目录穿越?）",
            "序列化对象（PHP/Java/Python pickle）→ 反序列化",
        ],
    },
    {
        "id": "headers",
        "title": "响应头",
        "checks": ["X-Flag / X-Debug 等自定义头", "Server/X-Powered-By 指纹", "缺失的安全头（记为信息）"],
    },
    {
        "id": "sensitive-files",
        "title": "敏感文件探测",
        "checks": ["/.git/HEAD", "/.env", "/backup.zip", "/swagger.json", "/actuator/env", "/phpinfo.php"],
    },
]

# ROI order for testing vuln classes (deterministic)
ROI_ORDER = ["idor", "auth", "sqli", "xss", "ssrf", "lfi", "business-logic", "open-redirect"]


def opening_checklist_text() -> str:
    lines = ["[web 开局 5 项 — 固定跑完，结构化输出后再决策]"]
    for item in OPENING_CHECKLIST:
        lines.append(f"\n{item['title']} ({item['id']}):")
        for c in item["checks"]:
            lines.append(f"  - [ ] {c}")
    lines.append("\n测什么漏洞的决策公式：输入点清单 × 功能语义 × 技术栈指纹 → 查映射表 → 按 ROI 排序")
    lines.append("ROI 顺序: " + " > ".join(ROI_ORDER))
    lines.append("每个输入点 3 种 payload 变体，失败即换（熔断）。")
    return "\n".join(lines)
