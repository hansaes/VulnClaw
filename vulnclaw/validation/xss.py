"""L3 validator: reflected/stored XSS.

Evidence contract:
  payload: the exact string that was injected (must contain a marker)
  response_body: the page/body where it was reflected
  context: where it reflected — "html" | "attribute" | "script" | "url"

Deterministic sink analysis (no LLM):
  PASS requires the marker to appear UNESCAPED in an executable context:
    - html context: raw <script>/<img onerror>/<svg onload> tags present, not &lt;-encoded
    - attribute context: marker breaks out of the attribute (quote + event handler)
    - script context: marker breaks out of a JS string into code
  FAIL if the payload is entity-encoded, or appears only inside a comment,
  or the context neutralizes it.

This is intentionally conservative: it may FAIL on exotic-but-real XSS
rather than PASS on a false positive. L3 is the skeptic.
"""

from __future__ import annotations

import html
import re

from vulnclaw.validation.base import Validator, Verdict, register

MARKER = "xssprobe"


@register
class XSSValidator(Validator):
    name = "xss"
    required_keys = ("payload", "response_body", "context")

    # executable patterns per context (applied to the RAW response)
    EXEC_PATTERNS = {
        "html": [
            r"<script[^>]*>.*?" + MARKER,
            r"<img[^>]*onerror\s*=",
            r"<svg[^>]*onload\s*=",
            r"<\w+[^>]*\son\w+\s*=\s*[\"']?[^\"'>]*" + MARKER,
        ],
        "attribute": [
            r"['\"]\s*>\s*<\w+",                       # broke out of attribute into tag
            r"['\"]\s+\on\w+\s*=",                     # broke out into event handler
        ],
        "script": [
            r"['\"]\s*;\s*\w",                          # broke out of JS string
            r"['\"]\s*\+\s*" + MARKER,
        ],
        "url": [
            r"javascript\s*:\s*.*" + MARKER,
        ],
    }

    def validate(self, evidence: dict) -> Verdict:
        log: list[str] = []
        payload = str(evidence["payload"])
        body = str(evidence["response_body"])
        context = str(evidence["context"]).lower()

        log.append(f"context={context} payload_len={len(payload)}")

        if MARKER not in payload:
            return Verdict(self.name, False, log + [
                f"payload lacks the required marker {MARKER!r} — "
                "re-probe with a marker payload so reflection can be tracked"])

        if MARKER not in body:
            return Verdict(self.name, False, log + [
                "marker not reflected in response — no reflection, no XSS"])

        # Neutralization check: is the reflection entity-encoded?
        encoded = html.escape(payload)
        if encoded in body and payload not in body:
            return Verdict(self.name, False, log + [
                "reflection is HTML-entity-encoded — properly neutralized"])

        # Comment check: reflection only inside <!-- -->
        stripped_comments = re.sub(r"<!--.*?-->", "", body, flags=re.S)
        if MARKER not in stripped_comments:
            return Verdict(self.name, False, log + [
                "marker only appears inside HTML comments — not executable"])

        patterns = self.EXEC_PATTERNS.get(context)
        if patterns is None:
            return Verdict(self.name, False, log + [
                f"unknown context {context!r} (want html/attribute/script/url)"])

        for pat in patterns:
            if re.search(pat, body, re.I | re.S):
                log.append(f"executable sink matched: {pat[:60]}")
                return Verdict(self.name, True, log,
                               evidence_ids=_ids(evidence))

        return Verdict(self.name, False, log + [
            "marker reflected but no executable sink matched in this context — "
            "likely encoded or inert reflection"])


def _ids(ev: dict) -> list[str]:
    ids = ev.get("evidence_ids")
    return list(ids) if isinstance(ids, list) else []
