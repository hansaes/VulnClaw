"""L3 validator: SSRF.

Two evidence flavors (either suffices):
  1. callback (out-of-band): L2 ran a callback listener; evidence carries
     {"callback_received": true, "callback_url": ..., "source_ip": ...}
     → PASS if the target fetched OUR callback URL.
  2. differential: {"external_probe": {...}, "internal_probe": {...}}
     each {"status": int, "body_len": int, "body_hash": str, "elapsed_ms": float}
     → PASS if the internal probe (169.254.169.254 / 10/8 / 172.16/12 /
     192.168/16 / localhost) returns something the external probe does not.

Without either, FAIL — a 200 on the fetch endpoint alone proves nothing.
"""

from __future__ import annotations

import ipaddress

from vulnclaw.validation.base import Validator, Verdict, register


def _is_internal(url: str) -> bool:
    host = url.split("://", 1)[-1].split("/", 1)[0].split("@")[-1].split(":")[0].lower()
    if host in ("localhost", "metadata.google.internal") or host.endswith(".internal"):
        return True
    try:
        return ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_link_local
    except ValueError:
        return False


@register
class SSRFValidator(Validator):
    name = "ssrf"
    required_keys = ("mode",)

    def validate(self, evidence: dict) -> Verdict:
        mode = evidence.get("mode")
        log: list[str] = []
        if mode == "callback":
            return self._callback(evidence, log)
        if mode == "differential":
            return self._differential(evidence, log)
        return Verdict(self.name, False, log + [
            f"unknown mode {mode!r} (want 'callback' or 'differential')"])

    def _callback(self, ev: dict, log: list[str]) -> Verdict:
        received = bool(ev.get("callback_received"))
        url = ev.get("callback_url", "")
        log.append(f"callback_url={url} received={received}")
        if not received:
            return Verdict(self.name, False, log + [
                "no callback hit — the server did not fetch our URL; "
                "either not SSRF or egress is blocked (try DNS exfil)"])
        log.append("server fetched our callback URL — SSRF confirmed (server-side request)")
        return Verdict(self.name, True, log, evidence_ids=_ids(ev))

    def _differential(self, ev: dict, log: list[str]) -> Verdict:
        for k in ("external_probe", "internal_probe"):
            if k not in ev:
                return Verdict(self.name, False, log + [f"missing {k}"])
        ext, intr = ev["external_probe"], ev["internal_probe"]
        target = str(ev.get("internal_url", ""))
        log.append(f"internal_url={target}")
        log.append(f"external: status={ext.get('status')} len={ext.get('body_len')}")
        log.append(f"internal: status={intr.get('status')} len={intr.get('body_len')}")

        if target and not _is_internal(target):
            return Verdict(self.name, False, log + [
                f"{target} is not an internal address — use 169.254.169.254, "
                "10/8, 172.16/12, 192.168/16 or localhost for the internal probe"])

        if intr.get("body_hash") == ext.get("body_hash"):
            return Verdict(self.name, False, log + [
                "internal and external probes return identical content — "
                "no differential, likely just an open redirect or passthrough"])

        if intr.get("status") in (200,) and intr.get("body_len", 0) > 0:
            log.append("internal probe returned distinct content — SSRF differential confirmed")
            return Verdict(self.name, True, log, evidence_ids=_ids(ev))
        return Verdict(self.name, False, log + [
            "internal probe gave no usable content — inconclusive"])


def _ids(ev: dict) -> list[str]:
    ids = ev.get("evidence_ids")
    return list(ids) if isinstance(ids, list) else []
