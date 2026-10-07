"""Rule-based assistant for the Web UI chat.

Understands operational commands in Chinese and English:

* start a task — "对 example.com 做一次扫描" / "scan example.com"
* check progress — "任务进度怎么样" / "progress"
* vulnerability summary — "example.com 有哪些漏洞"
* help — "你能做什么" / "help"

This is intentionally rule-based (not an LLM loop): every action maps to a
real backend operation and the reply states exactly what was done.
"""

from __future__ import annotations

import re
from typing import Any

_URL_RE = re.compile(r"https?://[^\s，。,;；]+", re.IGNORECASE)
_DOMAIN_RE = re.compile(
    r"\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b"
)
_IP_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")


def _is_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def _extract_target(text: str) -> str | None:
    m = _URL_RE.search(text)
    if m:
        return m.group(0).rstrip(").")
    m = _IP_RE.search(text)
    if m:
        return m.group(0)
    m = _DOMAIN_RE.search(text)
    if m:
        return m.group(0)
    return None


def _detect_command(text: str) -> str:
    low = text.lower()
    if any(k in text for k in ("持续", "continuous", "persistent")) or "persistent" in low:
        return "persistent"
    if any(k in text for k in ("利用", "验证漏洞", "漏洞验证")) or "exploit" in low:
        return "exploit"
    if any(k in text for k in ("侦察", "信息收集")) or "recon" in low:
        return "recon"
    if any(k in text for k in ("渗透", "全面测试")) or "pentest" in low or re.search(r"\bfull\b", low):
        return "run"
    return "scan"


def parse_message(text: str) -> dict[str, Any]:
    """Parse a chat message into an intent dict."""
    raw = (text or "").strip()
    zh = _is_chinese(raw)
    low = raw.lower()
    target = _extract_target(raw)

    help_hit = any(k in raw for k in ("你能做什么", "帮助", "怎么用")) or low in ("help", "?") or "help" in low
    if help_hit:
        return {"intent": "help", "zh": zh}

    progress_hit = any(k in raw for k in ("进度", "进行中", "状态怎么样", "跑得怎么样")) or "progress" in low or "status" in low
    if progress_hit and not target:
        return {"intent": "task_progress", "zh": zh}

    list_hit = any(k in raw for k in ("任务列表", "有哪些任务", "历史任务")) or "list tasks" in low
    if list_hit:
        return {"intent": "task_list", "zh": zh}

    vuln_hit = any(k in raw for k in ("漏洞", "有哪些发现")) or "vuln" in low or "finding" in low
    # Match action verbs on the text with the target removed, so a domain
    # like test.com is not mistaken for the verb "test".
    verb_text = raw.replace(target, "", 1) if target else raw
    verb_low = verb_text.lower()
    start_verb = target is not None and (
        any(k in verb_text for k in ("扫描", "开", "新建", "启动", "跑", "测一下", "测一测", "打一下", "做"))
        or bool(re.search(r"\b(scan|start|run|test|check)\b", verb_low))
    )
    if vuln_hit and not start_verb:
        return {"intent": "vuln_summary", "zh": zh, "target": target}

    start_hit = start_verb or (target is not None and any(k in raw for k in ("对", "针对")))
    if start_hit and target:
        return {"intent": "start_task", "zh": zh, "target": target, "command": _detect_command(raw)}

    return {"intent": "unknown", "zh": zh}
