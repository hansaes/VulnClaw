"""L3 validator: IDOR / broken object-level authorization.

Evidence contract (L2 must collect with TWO accounts — E6):
  resource_id: the id that was tested
  victim_session:   {"status": int, "body_hash": str, "body_len": int}
  attacker_session: {"status": int, "body_hash": str, "body_len": int}
  attacker_is_unauthorized: bool  (attacker must NOT own / have rights to the id)

PASS: attacker (no rights) receives the same object the victim sees
(HTTP 200 + identical body hash). FAIL otherwise.
"""

from __future__ import annotations

from vulnclaw.validation.base import Validator, Verdict, register


@register
class IDORValidator(Validator):
    name = "idor"
    required_keys = ("resource_id", "victim_session", "attacker_session",
                     "attacker_is_unauthorized")

    def validate(self, evidence: dict) -> Verdict:
        log: list[str] = []
        rid = evidence["resource_id"]
        victim = evidence["victim_session"]
        attacker = evidence["attacker_session"]
        unauthorized = bool(evidence["attacker_is_unauthorized"])

        log.append(f"resource_id={rid}")
        log.append(f"victim: status={victim.get('status')} len={victim.get('body_len')}")
        log.append(f"attacker: status={attacker.get('status')} len={attacker.get('body_len')} "
                   f"(unauthorized={unauthorized})")

        if not unauthorized:
            return Verdict(self.name, False, log + [
                "attacker_is_unauthorized=false — the test account has rights to "
                "this object, so a 200 proves nothing. Retest with a truly "
                "unauthorized account (E6 dual-account gate)."])

        if attacker.get("status") != 200:
            return Verdict(self.name, False, log + [
                f"attacker got {attacker.get('status')} — access correctly denied"])

        if victim.get("status") != 200:
            return Verdict(self.name, False, log + [
                "victim baseline is not 200 — cannot compare; fix the baseline first"])

        if attacker.get("body_hash") != victim.get("body_hash"):
            return Verdict(self.name, False, log + [
                "attacker 200 but body differs from victim — likely a generic "
                "success/error page, not the object. Compare bodies manually."])

        log.append("attacker retrieved the identical object without authorization — IDOR confirmed")
        return Verdict(self.name, True, log, evidence_ids=_ids(evidence))


def _ids(ev: dict) -> list[str]:
    ids = ev.get("evidence_ids")
    return list(ids) if isinstance(ids, list) else []
