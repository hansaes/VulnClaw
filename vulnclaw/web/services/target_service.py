"""Target-state service for the Web UI backend."""

from __future__ import annotations

import json
from pathlib import Path

from vulnclaw.agent.context import SessionState
from vulnclaw.agent.distiller import RunArtifacts, persist_run_memory
from vulnclaw.config.settings import TARGETS_DIR, ensure_dirs
from vulnclaw.kb.experience import ExperienceStore
from vulnclaw.target_state.store import (
    clear_target_state,
    diff_target_state_snapshots,
    get_target_state_preview,
    list_target_snapshots,
    load_target_state,
    rollback_target_state,
    save_target_state,
)
from vulnclaw.targets import parse_target, target_experience_key
from vulnclaw.web.schemas import (
    TargetPreviewView,
    TargetSnapshotView,
    TargetStateDiffView,
    TargetView,
)


def list_targets(limit: int = 20) -> list[TargetView]:
    """List recent targets from the newest persisted target state.

    Run-backed tasks persist their current state under the run directory and
    leave an ``index.json`` mirror under ``TARGETS_DIR``.  The old
    implementation only scanned the legacy ``state.json`` files, so a newly
    completed task could be visible in History while its findings were absent
    from the Findings page.  Read both layouts and keep the newest snapshot
    for each target.
    """
    ensure_dirs()
    latest: dict[str, tuple[float, TargetView]] = {}

    def add_state(path: Path) -> None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(raw, dict):
            return
        view = _build_target_view(raw)
        timestamp = _mtime(path)
        previous = latest.get(view.target)
        if previous is None or timestamp >= previous[0]:
            latest[view.target] = (timestamp, view)

    # Legacy/global state written without a run context.
    for state_path in TARGETS_DIR.glob("*/state.json"):
        add_state(state_path)

    # Current state for run-backed tasks is addressed by index.json.
    for index_path in TARGETS_DIR.glob("*/index.json"):
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(index, dict):
            continue
        run_dir = index.get("run_dir")
        target_id = index.get("target_id")
        if not run_dir or not target_id:
            continue
        current_path = Path(str(run_dir)) / "targets" / str(target_id) / "state" / "current.json"
        if current_path.is_file():
            add_state(current_path)

    items = sorted(latest.values(), key=lambda item: item[0], reverse=True)
    return [view for _, view in items[:limit]]


def get_target(target: str) -> TargetView | None:
    """Load a single target view."""
    raw = load_target_state(target)
    if not raw:
        return None
    return _build_target_view(raw)


def get_target_raw(target: str) -> dict | None:
    """Load raw target state."""
    return load_target_state(target)


def reject_finding(target: str, finding_id: str, reason: str = "") -> TargetView | None:
    """Mark one persisted finding as a false positive.

    Review actions are written through the normal target-state serializer so
    the result is visible to the Web UI immediately and is available to the
    next resumed task.  The review is intentionally explicit: a verification
    task that did not reproduce an issue is not, by itself, proof that the
    original finding is false.
    """
    raw = load_target_state(target)
    if not raw:
        return None
    session = SessionState(
        **{
            k: v
            for k, v in raw.items()
            if k
            not in {"resume_meta", "resume_summary", "finding_meta", "recon_meta", "runtime_meta"}
        }
    )
    normalized_id = str(finding_id).strip()
    for finding in session.findings:
        if finding.finding_id != normalized_id:
            continue
        finding.mark_rejected(reason.strip() or "Marked as a false positive")
        save_target_state(
            target,
            session,
            command="finding_review",
            merge_existing=True,
        )
        # A manual false-positive decision is a durable target fact too.  Save
        # it immediately so a later task on the same domain does not rediscover
        # and re-escalate the same candidate, even when no LLM is configured.
        try:
            target_model = parse_target(target)
            resume_meta = raw.get("resume_meta", {})
            run_id = str(resume_meta.get("run_name") or f"finding-review-{normalized_id}")
            artifacts = RunArtifacts.from_session(
                run_id,
                session,
                target_key=target_experience_key(target_model),
            )
            persist_run_memory(artifacts, ExperienceStore())
        except Exception:
            # The finding review itself is already persisted; memory is an
            # optional enhancement and must never make the review fail.
            pass
        updated = load_target_state(target)
        return _build_target_view(updated) if updated else _build_target_view(session.model_dump(mode="json"))
    return None


def get_snapshots(target: str) -> list[TargetSnapshotView]:
    """Return target snapshots."""
    return [TargetSnapshotView(**item) for item in list_target_snapshots(target)]


def get_preview(target: str, snapshot_id: str | None = None) -> TargetPreviewView | None:
    """Return a preview of the resume plan for a target or snapshot."""
    raw = get_target_state_preview(target, snapshot_id=snapshot_id)
    if not raw:
        return None
    return TargetPreviewView(**raw)


def get_diff(
    target: str, from_snapshot_id: str, to_snapshot_id: str | None = None
) -> TargetStateDiffView | None:
    """Return a diff between two snapshots, or a snapshot and current state."""
    raw = diff_target_state_snapshots(target, from_snapshot_id, to_snapshot_id=to_snapshot_id)
    if not raw:
        return None
    return TargetStateDiffView(**raw)


def rollback_target(target: str, snapshot_id: str) -> bool:
    """Rollback target state to a snapshot."""
    return rollback_target_state(target, snapshot_id) is not None


def clear_target(target: str) -> bool:
    """Clear a target state tree."""
    return clear_target_state(target)


def _build_target_view(raw: dict) -> TargetView:
    session = SessionState(
        **{
            k: v
            for k, v in raw.items()
            if k
            not in {"resume_meta", "resume_summary", "finding_meta", "recon_meta", "runtime_meta"}
        }
    )
    resume_meta = raw.get("resume_meta", {})
    return TargetView(
        target=session.target or resume_meta.get("target", "unknown"),
        schema_version=int(raw.get("schema_version", 1)),
        phase=session.phase.value if hasattr(session.phase, "value") else str(session.phase),
        findings_count=len(session.findings),
        verified_count=len(session.get_verified_findings()),
        pending_count=len(session.get_pending_findings()),
        candidate_count=len(session.get_candidate_findings())
        if hasattr(session, "get_candidate_findings")
        else 0,
        pending_verification_count=(
            len(session.get_pending_verification_findings())
            if hasattr(session, "get_pending_verification_findings")
            else 0
        ),
        manual_review_count=len(session.get_manual_review_findings())
        if hasattr(session, "get_manual_review_findings")
        else 0,
        resume_strategy=resume_meta.get("resume_strategy", ""),
        resume_reason=resume_meta.get("resume_strategy_reason", ""),
        constraints=session.task_constraints.model_dump(mode="json")
        if hasattr(session, "task_constraints")
        else {},
        constraint_violations=list(getattr(session, "constraint_violations", [])),
        constraint_violation_events=[
            item.model_dump(mode="json") if hasattr(item, "model_dump") else item
            for item in getattr(session, "constraint_violation_events", [])
        ],
        raw=raw,
    )


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0
