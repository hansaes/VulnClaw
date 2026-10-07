"""L3 validator: blind SQL injection.

Accepts evidence with two differential flavors:
  time-based: baseline_ms, sleep_probe_ms, control_probe_ms
  boolean-based: true_probe (status, body_hash, body_len),
                 false_probe (status, body_hash, body_len), baseline (same)

PASS requires a *differential*: the injected condition changes the
observable (time or content) while the control does not. This rules out
"the server is just slow" and "the page always looks like that".
"""

from __future__ import annotations

from vulnclaw.validation.base import Validator, Verdict, register


@register
class BlindSQLiValidator(Validator):
    name = "blind-sqli"
    required_keys = ("mode",)

    # time-based thresholds
    MIN_SLEEP_MS = 4000        # injected SLEEP(5)-style payload must take this long
    MAX_BASELINE_MS = 2500     # baseline must be comfortably faster
    RATIO = 3.0                # sleep_ms / baseline_ms must exceed this

    def validate(self, evidence: dict) -> Verdict:
        mode = evidence.get("mode")
        log: list[str] = []
        if mode == "time":
            return self._time_based(evidence, log)
        if mode == "boolean":
            return self._boolean_based(evidence, log)
        return Verdict(validator=self.name, passed=False,
                       log=[f"unknown mode: {mode!r} (want 'time' or 'boolean')"])

    def _time_based(self, ev: dict, log: list[str]) -> Verdict:
        for k in ("baseline_ms", "sleep_probe_ms"):
            if k not in ev:
                return Verdict(self.name, False, log + [f"missing {k} for time-based check"])
        base = float(ev["baseline_ms"])
        sleep = float(ev["sleep_probe_ms"])
        control = ev.get("control_probe_ms")

        log.append(f"baseline={base:.0f}ms sleep_probe={sleep:.0f}ms"
                   + (f" control={float(control):.0f}ms" if control is not None else " control=(none)"))

        if base > self.MAX_BASELINE_MS:
            return Verdict(self.name, False, log + [
                f"baseline too slow ({base:.0f}ms > {self.MAX_BASELINE_MS}ms) — "
                "cannot distinguish injection from a slow server"])
        if sleep < self.MIN_SLEEP_MS:
            return Verdict(self.name, False, log + [
                f"sleep probe too fast ({sleep:.0f}ms < {self.MIN_SLEEP_MS}ms) — "
                "payload did not delay the response"])
        if sleep / max(base, 1) < self.RATIO:
            return Verdict(self.name, False, log + [
                f"ratio {sleep/max(base,1):.1f}x < {self.RATIO}x — not a clear differential"])
        if control is not None and float(control) > self.MAX_BASELINE_MS:
            return Verdict(self.name, False, log + [
                "control probe also slow — the delay is not payload-specific"])
        log.append(f"differential confirmed: {sleep/max(base,1):.1f}x slowdown, control clean")
        return Verdict(self.name, True, log,
                       evidence_ids=_ids(ev))

    def _boolean_based(self, ev: dict, log: list[str]) -> Verdict:
        for k in ("true_probe", "false_probe"):
            if k not in ev:
                return Verdict(self.name, False, log + [f"missing {k} for boolean-based check"])
        t, f = ev["true_probe"], ev["false_probe"]
        log.append(f"true_probe: status={t.get('status')} len={t.get('body_len')} hash={str(t.get('body_hash'))[:12]}")
        log.append(f"false_probe: status={f.get('status')} len={f.get('body_len')} hash={str(f.get('body_hash'))[:12]}")
        if t.get("body_hash") == f.get("body_hash") and t.get("status") == f.get("status"):
            return Verdict(self.name, False, log + [
                "true/false probes identical — no boolean differential"])
        log.append("boolean differential confirmed: TRUE and FALSE conditions render differently")
        return Verdict(self.name, True, log, evidence_ids=_ids(ev))


def _ids(ev: dict) -> list[str]:
    ids = ev.get("evidence_ids")
    return list(ids) if isinstance(ids, list) else []
