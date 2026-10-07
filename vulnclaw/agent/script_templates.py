"""Deterministic script skeletons for AI-driven exploitation (E7).

Research finding (pawnlogic): don't let the LLM write exploits from scratch.
Generate 80% of the skeleton deterministically (connection handling,
local/remote switch, library loading); the model only fills the critical 20%
(offsets, payload logic). Success rate differs by an order of magnitude.

Each template is a Python source string with clearly marked FILL-IN sections.
"""

from __future__ import annotations


PWNTOOLS_TEMPLATE = '''#!/usr/bin/env python3
"""Pwntools exploit skeleton — FILL IN the marked sections, then run."""
from pwn import *

# ── FILL IN: target ──────────────────────────────────────────────
HOST = "TARGET_HOST"   # e.g. "10.10.10.5" or "localhost"
PORT = 1337
BINARY = "./vuln"      # local binary path (for local testing)
# ────────────────────────────────────────────────────────────────

context.arch = "amd64"   # FILL IN: check with `checksec` / `file`
context.os = "linux"

def get_conn(remote_mode=True):
    if remote_mode:
        return remote(HOST, PORT)
    return process(BINARY)

def exploit(remote_mode=True):
    io = get_conn(remote_mode)
    # ── FILL IN: exploitation logic ──────────────────────────
    # Example pattern:
    #   io.recvuntil(b"> ")
    #   io.sendline(b"A" * OFFSET + p64(WIN_ADDR))
    #   io.interactive()
    # ────────────────────────────────────────────────────────
    io.interactive()

if __name__ == "__main__":
    import sys
    remote_mode = "--local" not in sys.argv
    exploit(remote_mode=remote_mode)
'''


WEB_POC_TEMPLATE = '''#!/usr/bin/env python3
"""Web PoC skeleton — FILL IN the marked sections, then run.
Idempotent: running twice must produce the same observable result.
"""
import requests

# ── FILL IN: target ──────────────────────────────────────────
BASE = "http://TARGET:PORT"
TIMEOUT = 10
# ────────────────────────────────────────────────────────────

s = requests.Session()
s.headers["User-Agent"] = "VulnClaw-PoC/1.0"

def baseline():
    """FILL IN: one clean request proving the endpoint is alive."""
    r = s.get(BASE + "/", timeout=TIMEOUT)
    print(f"[baseline] {r.status_code} len={len(r.text)}")
    return r

def probe():
    """FILL IN: the actual vulnerability probe. Print differential evidence."""
    # Example pattern:
    #   r1 = s.get(BASE + "/api/user/1", timeout=TIMEOUT)   # own resource
    #   r2 = s.get(BASE + "/api/user/2", timeout=TIMEOUT)   # other resource
    #   print(f"[probe] own={r1.status_code} other={r2.status_code}")
    #   print(f"[probe] leaked_other_data={'email' in r2.text}")
    raise NotImplementedError("fill in probe()")

if __name__ == "__main__":
    baseline()
    probe()
'''


SCANNER_TEMPLATE = '''#!/usr/bin/env python3
"""Lightweight scanner skeleton — FILL IN the marked sections, then run.
Cost discipline: cheap checks first (status/length), expensive last.
"""
import socket
from concurrent.futures import ThreadPoolExecutor

# ── FILL IN: target ──────────────────────────────────────────
TARGET = "TARGET_HOST"
PORTS = [21, 22, 80, 443, 3306, 8080]   # FILL IN after quick recon
TIMEOUT = 2.0
# ────────────────────────────────────────────────────────────

def check_port(port):
    try:
        sock = socket.create_connection((TARGET, port), timeout=TIMEOUT)
        try:
            sock.settimeout(2.0)
            banner = sock.recv(1024).decode(errors="replace").strip()
        except Exception:
            banner = ""
        finally:
            sock.close()
        return port, True, banner[:120]
    except Exception:
        return port, False, ""

if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=20) as ex:
        for port, is_open, banner in ex.map(check_port, PORTS):
            if is_open:
                print(f"[open] {TARGET}:{port} banner={banner!r}")
    print("[done]")
'''


CRYPTO_TEMPLATE = '''#!/usr/bin/env python3
"""Crypto helper skeleton — FILL IN the marked sections, then run."""
# Common imports; uncomment what you need:
# from Crypto.Util.number import long_to_bytes, bytes_to_long, inverse
# from Crypto.PublicKey import RSA

# ── FILL IN: given values ────────────────────────────────────
N = 0  # modulus
E = 65537
C = 0  # ciphertext
# ────────────────────────────────────────────────────────────

def solve():
    # ── FILL IN: attack logic ────────────────────────────────
    # Example: factor N, compute d, decrypt C
    raise NotImplementedError("fill in solve()")

if __name__ == "__main__":
    result = solve()
    print(f"[result] {result}")
'''


TEMPLATES: dict[str, dict[str, str]] = {
    "pwn": {
        "name": "pwntools exploit (local/remote switch)",
        "description": "Binary exploitation skeleton with --local flag. Fill in HOST/PORT/BINARY and payload logic.",
        "source": PWNTOOLS_TEMPLATE,
    },
    "web": {
        "name": "web PoC (requests, baseline + probe)",
        "description": "Web vulnerability PoC with mandatory baseline() and differential probe(). Idempotent by contract.",
        "source": WEB_POC_TEMPLATE,
    },
    "scan": {
        "name": "lightweight port/banner scanner",
        "description": "Threaded TCP connect + banner grab. Fill in TARGET/PORTS. Cheap checks first.",
        "source": SCANNER_TEMPLATE,
    },
    "crypto": {
        "name": "crypto helper",
        "description": "RSA/classic crypto attack skeleton. Fill in N/E/C and attack logic.",
        "source": CRYPTO_TEMPLATE,
    },
}


def list_templates() -> str:
    lines = ["Available script templates (use get_script_template):"]
    for key, meta in TEMPLATES.items():
        lines.append(f"- {key}: {meta['name']} — {meta['description']}")
    return "\n".join(lines)


def get_template(key: str) -> str | None:
    meta = TEMPLATES.get(key)
    return meta["source"] if meta else None
