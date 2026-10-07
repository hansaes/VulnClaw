"""Crypto attack router: RSA decision tree + XOR + encoding detection (P0-4).

Research finding: for RSA, run RsaCtfTool FIRST, then walk the decision
tree one by one; only escalate to the LLM when all deterministic attacks
fail. Tools first, LLM last. Same for XOR and common encodings.
"""

from __future__ import annotations

import base64
import binascii
import re


# ── RSA decision tree (ordered; first hit wins) ─────────────────

RSA_TREE: list[dict] = [
    {"id": "rsactftool", "title": "RsaCtfTool 先行",
     "desc": "自动试 Wiener/FactorDB/Fermat 等十几种攻击。命令: python3 RsaCtfTool.py --publickey pub.pem --uncipher <c>",
     "when": "永远先跑这个"},
    {"id": "small-n", "title": "n 很小 → 直接分解",
     "desc": "gmpy2/sage factor(n)，或在线 FactorDB 查",
     "when": "n < 512 bit"},
    {"id": "cube-root", "title": "e=3 且 c < n → 直接开立方根",
     "desc": "m = gmpy2.iroot(c, 3)",
     "when": "e == 3 and c < n"},
    {"id": "hastad", "title": "Håstad 广播攻击",
     "desc": "同一明文 + 同 e + 多个 n → CRT 还原 m^e 再开 e 次方根",
     "when": "多个 (n, c) 对，e 相同"},
    {"id": "common-modulus", "title": "共模攻击",
     "desc": "同 n + 不同 e + 同明文 → 扩展欧几里得 gcdext 求组合系数",
     "when": "同 n，不同 e1/e2 加密同一明文"},
    {"id": "wiener", "title": "Wiener 攻击",
     "desc": "d 很小 → 连分数攻击。工具: owiener",
     "when": "d 疑似 < n^0.25"},
    {"id": "fermat", "title": "Fermat 分解",
     "desc": "p,q 接近 → 从 isqrt(n) 往上试 a^2 - n = b^2",
     "when": "p,q 接近（题目暗示或 n 形态）"},
    {"id": "pollard-p1", "title": "Pollard p-1",
     "desc": "p-1 光滑 → B 光滑数分解",
     "when": "p-1 的因子都很小"},
    {"id": "gcd-batch", "title": "批量 GCD",
     "desc": "多个 n 有公因子 → 两两 GCD",
     "when": "拿到多个 n"},
    {"id": "llm", "title": "转 LLM",
     "desc": "变体题（XOR 套 RSA、e 被二次加密等）→ 让 LLM 读代码找数学结构，再决定 Z3 约束求解还是手工推",
     "when": "以上全失败"},
]


def rsa_tree_text() -> str:
    lines = ["[RSA 决策树 — 按序逐个试，命中即停]"]
    for i, node in enumerate(RSA_TREE, 1):
        lines.append(f"{i}. {node['title']}\n   何时: {node['when']}\n   做法: {node['desc']}")
    return "\n".join(lines)


# ── XOR playbook ────────────────────────────────────────────────

XOR_PLAYBOOK = """[XOR 速查]
- 单字节 key → 256 爆破，英文评分找可读明文
- repeating key → 先用 Hamming 距离定 keylen，再逐位爆破
- 已知明文（known-plaintext）→ 明文 XOR 密文 = key，直接恢复
- key 疑似英文单词 → 字典爆破"""


# ── Encoding auto-detector (top 20) ─────────────────────────────

def _try_b64(s: str) -> str | None:
    try:
        cleaned = "".join(s.split())
        if len(cleaned) % 4 or not re.fullmatch(r"[A-Za-z0-9+/=]+", cleaned):
            return None
        raw = base64.b64decode(cleaned, validate=True)
        txt = raw.decode("utf-8", errors="strict")
        if _looks_readable(txt):
            return txt
    except Exception:
        return None
    return None


def _try_hex(s: str) -> str | None:
    try:
        cleaned = "".join(s.split()).lower().removeprefix("0x")
        if len(cleaned) % 2 or not re.fullmatch(r"[0-9a-f]+", cleaned) or len(cleaned) < 4:
            return None
        txt = bytes.fromhex(cleaned).decode("utf-8", errors="strict")
        if _looks_readable(txt):
            return txt
    except Exception:
        return None
    return None


def _try_rot(s: str, n: int) -> str | None:
    out = []
    for ch in s:
        if "a" <= ch <= "z":
            out.append(chr((ord(ch) - 97 + n) % 26 + 97))
        elif "A" <= ch <= "Z":
            out.append(chr((ord(ch) - 65 + n) % 26 + 65))
        else:
            out.append(ch)
    txt = "".join(out)
    return txt if _looks_readable(txt) and txt != s else None


def _looks_readable(txt: str) -> bool:
    if not txt or len(txt) < 3:
        return False
    letters = sum(c.isalpha() or c.isspace() for c in txt)
    return letters / len(txt) > 0.6


def detect_encoding(s: str) -> list[dict]:
    """Try common encodings; return hits with decoded text."""
    hits = []
    b64 = _try_b64(s)
    if b64:
        hits.append({"encoding": "base64", "decoded": b64[:200]})
    hx = _try_hex(s)
    if hx:
        hits.append({"encoding": "hex", "decoded": hx[:200]})
    for n in (13, 1, 25):
        r = _try_rot(s, n)
        if r:
            hits.append({"encoding": f"rot{n}", "decoded": r[:200]})
            break
    # urlsafe / reversed hints
    if s != s[::-1] and _looks_readable(s[::-1]):
        hits.append({"encoding": "reversed", "decoded": s[::-1][:200]})
    return hits
