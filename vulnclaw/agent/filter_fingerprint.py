"""WAF/filter fingerprinter (P0-5).

Research finding (ctf.arkx.ninja L9): before attacking the vulnerability,
fingerprint the FILTER itself — probe metacharacters one by one, record
blocked vs executed vs error for each, build the "usable charset". Only
then craft payloads. Blind RCE with suppressed output → switch to
out-of-band (DNS first, then HTTP) instead of more echo payloads.
"""

from __future__ import annotations


# Metacharacters to probe, in order (cheap → telling)
FINGERPRINT_PROBES: list[dict] = [
    {"payload": "'", "tests": "single quote — SQLi/error-based"},
    {"payload": '"', "tests": "double quote — SQLi/XSS context"},
    {"payload": "<", "tests": "XSS tag open"},
    {"payload": ">", "tests": "XSS tag close"},
    {"payload": "|", "tests": "command chaining"},
    {"payload": "&&", "tests": "command chaining (and)"},
    {"payload": "||", "tests": "command chaining (or)"},
    {"payload": ";", "tests": "command separator"},
    {"payload": "`", "tests": "backtick subshell"},
    {"payload": "$()", "tests": "dollar-paren subshell"},
    {"payload": "${IFS}", "tests": "space bypass variant"},
    {"payload": "%09", "tests": "tab-as-space bypass"},
    {"payload": "%0a", "tests": "newline injection"},
    {"payload": "../", "tests": "path traversal"},
    {"payload": "{{7*7}}", "tests": "SSTI probe"},
]

SPACE_BYPASS_VARIANTS = ["${IFS}", "%09", "%0a", "%0c", "%0d", "<>", "$IFS$9"]


def fingerprint_plan(param_name: str = "input") -> str:
    """Render the deterministic fingerprint procedure as instructions."""
    lines = [
        "[过滤器指纹流程 — 先打过滤器，再打漏洞]",
        f"目标参数: {param_name}",
        "对每个探针发一次，记录三类返回：BLOCKED（被拦/400/403）/ EXECUTED（执行了，有差异）/ ERROR（报错回显）",
        "",
    ]
    for i, probe in enumerate(FINGERPRINT_PROBES, 1):
        lines.append(f"{i}. 发送 `{probe['payload']}` → {probe['tests']}")
    lines += [
        "",
        "输出：可用字符集（哪些元字符能过）+ 被拦模式（关键词黑名单？长度限制？）",
        "然后：只用可用字符集构造 payload。",
        "若输出被完全吞掉（盲）：别再试回显型 payload，直接转外带 —— 先 DNS（nslookup/ dig），再 HTTP（curl/wget）。",
        "空格被拦时按序试: " + ", ".join(SPACE_BYPASS_VARIANTS),
    ]
    return "\n".join(lines)


def classify_probe_response(baseline: str, probe_response: str, status_code: int) -> str:
    """Heuristic classification of a single probe response.

    Returns one of: BLOCKED / EXECUTED / ERROR / SAME.
    Deterministic and explainable — the LLM reads the label, not raw diffs.
    """
    if status_code in (400, 403, 406, 418, 429):
        return "BLOCKED"
    if len(probe_response) == 0 and len(baseline) > 0:
        return "BLOCKED"
    lowered = probe_response.lower()
    error_markers = ["error", "exception", "traceback", "syntax", "warning", "blocked", "forbidden", "waf", "invalid"]
    if any(m in lowered for m in error_markers) and probe_response != baseline:
        return "ERROR"
    if probe_response != baseline:
        return "EXECUTED"
    return "SAME"
