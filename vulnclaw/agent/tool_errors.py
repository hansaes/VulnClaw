"""Structured tool errors (E13).

Plain `[!]` strings make the model retry blindly. Structured errors carry
a machine-readable code, a recovery hint, and a retryable flag so the
model can *fix its own parameters* instead of guessing.

Format (still a plain string, so it flows through the tool protocol):
    [ERR code=<CODE> retryable=<true|false>] <message>
    hint: <recovery_hint>

Example:
    [ERR code=SCHEMA_VIOLATION retryable=true] detect_encoding requires 'text' (non-empty string)
    hint: pass {"text": "<the mystery string>"} — see tool schema
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ── Error codes ───────────────────────────────────────────────────

class Err:
    SCHEMA_VIOLATION = "SCHEMA_VIOLATION"   # bad/missing args → fix params, retry
    NOT_FOUND = "NOT_FOUND"                 # evidence/tool/id missing → check list first
    TIMEOUT = "TIMEOUT"                     # slow target → raise timeout or narrow scope
    EXEC_FAILED = "EXEC_FAILED"             # command crashed → read stderr, fix command
    PERMISSION_DENIED = "PERMISSION_DENIED"  # blocked by policy → do NOT retry as-is
    RATE_LIMITED = "RATE_LIMITED"           # back off, do not hammer
    UNSUPPORTED = "UNSUPPORTED"             # tool/mode not available here → pick another tool
    AMBIGUOUS = "AMBIGUOUS"                 # need clarification → ask or gather more info
    INTERNAL = "INTERNAL"                   # agent bug → report, don't retry blindly


@dataclass
class ToolError:
    code: str
    message: str
    recovery_hint: str = ""
    retryable: bool = True
    details: dict = field(default_factory=dict)

    def render(self) -> str:
        head = f"[ERR code={self.code} retryable={'true' if self.retryable else 'false'}] {self.message}"
        if self.recovery_hint:
            return head + f"\nhint: {self.recovery_hint}"
        return head


def tool_error(code: str, message: str, hint: str = "", retryable: bool = True,
               **details) -> str:
    """Build a structured error string."""
    return ToolError(code=code, message=message, recovery_hint=hint,
                     retryable=retryable, details=details).render()


# ── Convenience constructors ────────────────────────────────────

def schema_violation(tool: str, what: str, example: str = "") -> str:
    hint = f"Fix the arguments and retry. See the {tool} schema."
    if example:
        hint += f" Example: {example}"
    return tool_error(Err.SCHEMA_VIOLATION, f"{tool}: {what}", hint, retryable=True)


def not_found(what: str, list_hint: str = "") -> str:
    hint = "The id may be wrong or expired."
    if list_hint:
        hint += f" Call {list_hint} to see valid ids."
    return tool_error(Err.NOT_FOUND, what, hint, retryable=False)


def exec_failed(tool: str, stderr_tail: str, hint: str = "") -> str:
    h = hint or "Read the stderr, fix the command/payload, then retry."
    return tool_error(Err.EXEC_FAILED, f"{tool} failed: {stderr_tail[:300]}", h, retryable=True)


def timed_out(tool: str, timeout_ms: int) -> str:
    return tool_error(
        Err.TIMEOUT,
        f"{tool} timed out after {timeout_ms}ms",
        "The target may be slow or the scope too large. Narrow the scope "
        "(fewer ports/paths) or raise the timeout and retry once.",
        retryable=True,
    )


def permission_denied(tool: str, reason: str) -> str:
    return tool_error(
        Err.PERMISSION_DENIED,
        f"{tool} blocked: {reason}",
        "Do NOT retry the same call. Change approach or ask the operator.",
        retryable=False,
    )
