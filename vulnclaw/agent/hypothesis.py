"""Hypothesis tracker for lead-driven exploration (CTF / pentest).

Implements E4/E5 from field research:
- E4: hypothesis circuit breaker — 3 failed tests or 20 minutes without
  progress → auto-abandon, back to recon.
- E5: abandoned != disproven — every abandoned hypothesis keeps a
  "reopen condition" so new evidence can revive it.

A hypothesis is a lead: "this looks like X because Y, test with Z".
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


#: Strikes before a hypothesis auto-abandons.
MAX_STRIKES = 3
#: Seconds without progress before a hypothesis auto-abandons (20 min).
STALE_SECONDS = 20 * 60


@dataclass
class Hypothesis:
    """One investigation lead."""

    id: str
    title: str
    description: str = ""
    test_plan: str = ""
    status: str = "active"  # active | testing | confirmed | abandoned
    strikes: int = 0
    created_at: float = field(default_factory=time.time)
    last_tested_at: float = field(default_factory=time.time)
    reopen_condition: str = ""
    evidence_ids: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "test_plan": self.test_plan,
            "status": self.status,
            "strikes": self.strikes,
            "reopen_condition": self.reopen_condition,
            "evidence_ids": self.evidence_ids,
            "notes": self.notes[-5:],
        }


class HypothesisTracker:
    """Track investigation leads with circuit-breaker semantics."""

    def __init__(self) -> None:
        self._items: dict[str, Hypothesis] = {}
        self._seq = 0

    def add(self, title: str, description: str = "", test_plan: str = "") -> Hypothesis:
        self._seq += 1
        hid = f"h{self._seq:02d}"
        hyp = Hypothesis(id=hid, title=title, description=description, test_plan=test_plan)
        self._items[hid] = hyp
        return hyp

    def get(self, hid: str) -> Hypothesis | None:
        return self._items.get(hid)

    def note_test(self, hid: str, *, success: bool, note: str = "", evidence_id: str = "") -> Hypothesis | None:
        """Record one test of a hypothesis. Returns the hypothesis (possibly auto-abandoned)."""
        hyp = self._items.get(hid)
        if hyp is None or hyp.status in ("confirmed", "abandoned"):
            return hyp
        hyp.status = "testing"
        hyp.last_tested_at = time.time()
        if note:
            hyp.notes.append(note)
        if evidence_id:
            hyp.evidence_ids.append(evidence_id)
        if success:
            hyp.strikes = 0
            hyp.status = "active"
        else:
            hyp.strikes += 1
            if hyp.strikes >= MAX_STRIKES:
                self._auto_abandon(hyp, reason=f"{MAX_STRIKES} failed tests without progress")
        return hyp

    def confirm(self, hid: str, evidence_id: str = "") -> Hypothesis | None:
        hyp = self._items.get(hid)
        if hyp is None:
            return None
        hyp.status = "confirmed"
        if evidence_id:
            hyp.evidence_ids.append(evidence_id)
        return hyp

    def abandon(self, hid: str, reopen_condition: str = "") -> Hypothesis | None:
        hyp = self._items.get(hid)
        if hyp is None:
            return None
        hyp.status = "abandoned"
        if reopen_condition:
            hyp.reopen_condition = reopen_condition
        return hyp

    def _auto_abandon(self, hyp: Hypothesis, reason: str) -> None:
        hyp.status = "abandoned"
        hyp.notes.append(f"[auto-abandoned] {reason}")
        if not hyp.reopen_condition:
            hyp.reopen_condition = "new evidence contradicting the failed tests"

    def sweep_stale(self) -> list[Hypothesis]:
        """Auto-abandon hypotheses idle for STALE_SECONDS. Returns newly abandoned."""
        now = time.time()
        newly: list[Hypothesis] = []
        for hyp in self._items.values():
            if hyp.status in ("active", "testing") and now - hyp.last_tested_at > STALE_SECONDS:
                self._auto_abandon(hyp, reason="no progress for 20 minutes")
                newly.append(hyp)
        return newly

    def check_reopen(self, evidence_summary: str) -> list[Hypothesis]:
        """Return abandoned hypotheses whose reopen condition might match new evidence.

        Simple keyword heuristic: if any significant word from the reopen
        condition appears in the evidence summary, flag for review.
        """
        matches: list[Hypothesis] = []
        summary = evidence_summary.lower()
        for hyp in self._items.values():
            if hyp.status != "abandoned" or not hyp.reopen_condition:
                continue
            keywords = [w for w in hyp.reopen_condition.lower().split() if len(w) > 4]
            if any(kw in summary for kw in keywords):
                matches.append(hyp)
        return matches

    def active(self) -> list[Hypothesis]:
        return [h for h in self._items.values() if h.status in ("active", "testing")]

    def abandoned(self) -> list[Hypothesis]:
        return [h for h in self._items.values() if h.status == "abandoned"]

    def confirmed(self) -> list[Hypothesis]:
        return [h for h in self._items.values() if h.status == "confirmed"]

    def summary(self) -> str:
        lines = []
        for hyp in self._items.values():
            lines.append(
                f"- {hyp.id} [{hyp.status}] {hyp.title} "
                f"(strikes={hyp.strikes})"
                + (f" → reopen if: {hyp.reopen_condition}" if hyp.status == "abandoned" and hyp.reopen_condition else "")
            )
        return "\n".join(lines) if lines else "(no hypotheses yet)"
