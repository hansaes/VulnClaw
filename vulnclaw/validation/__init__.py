"""L3 deterministic validators (P2c).

Layering:
  L1 — AI explores, proposes hypotheses
  L2 — evidence-first: controlled baseline/probe pairs recorded as evidence
  L3 — THIS MODULE: pure-code replay + assertions, no LLM calls

A finding only becomes reportable when its L3 validator returns PASS.
Timeout or exception → FAIL (fail-closed).
"""

from vulnclaw.validation.base import VALIDATORS, Verdict, run_validation

__all__ = ["VALIDATORS", "Verdict", "run_validation"]
