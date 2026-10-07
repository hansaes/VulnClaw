"""L3 validator base: Verdict, registry, fail-closed runner."""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class Verdict:
    validator: str
    passed: bool
    log: list[str] = field(default_factory=list)
    evidence_ids: list[str] = field(default_factory=list)

    def render(self) -> str:
        status = "PASS" if self.passed else "FAIL"
        lines = [f"[L3 {self.validator}] {status}"]
        lines.extend(f"  - {line}" for line in self.log)
        if self.evidence_ids:
            lines.append(f"  evidence: {', '.join(self.evidence_ids)}")
        return "\n".join(lines)


class Validator:
    """Base class. Subclasses implement validate(evidence) -> Verdict.

    evidence: dict with structured baseline/probe data collected at L2.
    No network, no LLM inside validate() — pure replay + assertions.
    """

    name: str = "base"
    # which evidence keys are required
    required_keys: tuple[str, ...] = ()

    def validate(self, evidence: dict) -> Verdict:
        raise NotImplementedError

    def check_keys(self, evidence: dict) -> str | None:
        missing = [k for k in self.required_keys if k not in evidence]
        if missing:
            return f"missing required evidence keys: {', '.join(missing)}"
        return None


VALIDATORS: dict[str, type[Validator]] = {}


def register(cls: type[Validator]) -> type[Validator]:
    VALIDATORS[cls.name] = cls
    return cls


def run_validation(validator_name: str, evidence: dict,
                   timeout_s: float = 10.0) -> Verdict:
    """Run a validator fail-closed: timeout/exception/missing → FAIL."""
    cls = VALIDATORS.get(validator_name)
    if cls is None:
        return Verdict(validator=validator_name, passed=False,
                       log=[f"unknown validator: {validator_name}",
                            f"available: {', '.join(sorted(VALIDATORS))}"])
    v = cls()
    key_err = v.check_keys(evidence)
    if key_err:
        return Verdict(validator=validator_name, passed=False, log=[key_err])

    started = time.perf_counter()
    try:
        verdict = v.validate(evidence)
    except Exception as exc:  # fail-closed
        return Verdict(validator=validator_name, passed=False,
                       log=[f"validator crashed: {exc.__class__.__name__}: {exc}"])
    elapsed = time.perf_counter() - started
    if elapsed > timeout_s:
        return Verdict(validator=validator_name, passed=False,
                       log=[f"validator exceeded {timeout_s}s budget ({elapsed:.1f}s)"])
    verdict.log.append(f"completed in {elapsed*1000:.0f}ms")
    return verdict


def list_validators() -> str:
    lines = ["[L3 validators]"]
    for name in sorted(VALIDATORS):
        cls = VALIDATORS[name]
        lines.append(f"  {name}: needs {', '.join(cls.required_keys) or '(none)'}")
    return "\n".join(lines)
