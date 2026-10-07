"""Web API service for the VulnClaw memory (knowledge-base lessons).

Exposes the file-backed :class:`ExperienceStore` over HTTP so the Web UI can
browse and curate two kinds of memory:

* **global** — ``scope=technique`` lessons, shared across all pentests;
* **per-target** — ``scope=target`` lessons bound to one ``target_key``
  (domain / website), re-loaded by the agent when a task resumes on it.
"""

from __future__ import annotations

from typing import Any, Optional
from uuid import uuid4

from vulnclaw.kb.experience import (
    ExperienceStore,
    LessonScope,
    LessonSignal,
    LessonStatus,
)

_store: ExperienceStore | None = None


def _store_instance() -> ExperienceStore:
    global _store
    if _store is None:
        _store = ExperienceStore()
    return _store


def _all_lessons() -> list:
    store = _store_instance()
    lessons = []
    for status in (LessonStatus.APPROVED, LessonStatus.PENDING, LessonStatus.REJECTED):
        lessons.extend(store.list_by_status(status))
    lessons.sort(key=lambda item: item.created_at, reverse=True)
    return lessons


def list_lessons(
    scope: Optional[str] = None,
    target_key: Optional[str] = None,
    status: Optional[str] = None,
) -> list[dict[str, Any]]:
    """List lessons, optionally filtered by scope / target / status."""
    out = []
    for lesson in _all_lessons():
        if scope and lesson.scope.value != scope:
            continue
        if target_key and lesson.target_key != target_key:
            continue
        if status and lesson.status.value != status:
            continue
        out.append(lesson.model_dump(mode="json"))
    return out


def create_lesson(payload: dict[str, Any]) -> dict[str, Any]:
    """Create a new lesson (always starts as pending)."""
    scope = LessonScope(payload.get("scope") or "technique")
    target_key = (payload.get("target_key") or "").strip() or None
    if scope is LessonScope.TARGET and not target_key:
        raise ValueError("target_key is required for target-scoped lessons")
    if scope is LessonScope.TECHNIQUE:
        target_key = None
    lesson = {
        "id": "lsn-" + uuid4().hex[:12],
        "scope": scope.value,
        "signal": LessonSignal(payload.get("signal") or "success").value,
        "context": payload["context"],
        "lesson": payload["lesson"],
        "target_key": target_key,
        "confidence": float(payload.get("confidence") or 0.8),
        "tags": {
            "tech": payload.get("tech") or [],
            "vuln_type": payload.get("vuln_type") or "",
        },
        # Manually curated from the Web UI — no single run to reference.
        "evidence_refs": {"run_id": "web-ui"},
    }
    created = _store_instance().add(lesson)
    return created.model_dump(mode="json")


def delete_lesson(lesson_id: str) -> bool:
    return _store_instance().delete(lesson_id)


def approve_lesson(lesson_id: str) -> dict[str, Any] | None:
    lesson = _store_instance().approve(lesson_id)
    return lesson.model_dump(mode="json") if lesson else None


def memory_summary() -> dict[str, Any]:
    """Counts for the memory overview: global + per-target."""
    technique = 0
    targets: dict[str, int] = {}
    for lesson in _all_lessons():
        if lesson.status is not LessonStatus.APPROVED:
            continue
        if lesson.scope is LessonScope.TECHNIQUE:
            technique += 1
        elif lesson.target_key:
            targets[lesson.target_key] = targets.get(lesson.target_key, 0) + 1
    return {
        "technique_count": technique,
        "targets": [{"target_key": k, "count": v} for k, v in sorted(targets.items())],
    }
