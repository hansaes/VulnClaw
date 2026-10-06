"""Task orchestration service for the Web UI backend."""

from __future__ import annotations

import asyncio

from vulnclaw.agent.core import AgentCore
from vulnclaw.config.settings import load_config
from vulnclaw.i18n import init_i18n
from vulnclaw.mcp.lifecycle import MCPLifecycleManager
from vulnclaw.task_service import execute_task, prepare_task
from vulnclaw.web.schemas import TaskCreateRequest
from vulnclaw.web.task_manager import WebTaskManager

#: Solve-engine events bridged onto the Web task stream. ``agent_step`` fires
#: before every model call and carries nothing the following observation event
#: does not repeat, so it is dropped to keep the console feed readable.
_SOLVE_EVENT_KINDS = frozenset(
    {
        "agent_observation",
        "subagent",
        "group_progress",
        "ask_user",
        "ask_user_rejected",
        "no_path",
        "no_path_rejected",
        "completed",
        "complete_rejected",
        "error",
    }
)

#: Cap on tool names rendered into one observation line.
_MAX_TOOLS_IN_TEXT = 6


def _as_text(value: object) -> str:
    """Return a stripped string for display, or an empty string."""
    return value.strip() if isinstance(value, str) else ""


def _event_text(kind: str, payload: dict) -> str:
    """Build the one-line summary the console renders for a solve event."""
    if kind == "agent_observation":
        text = _as_text(payload.get("reason")) or "model turn (no action reason)"
        tools = [str(tool) for tool in (payload.get("tools") or []) if tool]
        unique = list(dict.fromkeys(tools))
        if unique:
            shown = ", ".join(unique[:_MAX_TOOLS_IN_TEXT])
            suffix = ", …" if len(unique) > _MAX_TOOLS_IN_TEXT else ""
            text = f"{text}  [{shown}{suffix}]"
        return text
    if kind == "subagent":
        name = _as_text(payload.get("name")) or _as_text(payload.get("agent_id"))
        agent_type = _as_text(payload.get("agent_type"))
        status = _as_text(payload.get("status"))
        label = f"{name} ({agent_type})" if agent_type else name
        return " · ".join(part for part in (label, status) if part)
    if kind == "group_progress":
        parts = [_as_text(payload.get("name")) or "sub-agent group"]
        goal = _as_text(payload.get("goal"))
        if goal:
            parts.append(goal)
        total = payload.get("member_total")
        done = payload.get("member_done")
        if isinstance(total, int) and isinstance(done, int):
            parts.append(f"members {done}/{total}")
        waves = payload.get("wave_count")
        if isinstance(waves, int) and waves > 0:
            parts.append(f"waves {waves}")
        return " · ".join(parts)
    for key in ("reason", "question", "error", "message", "text"):
        value = _as_text(payload.get(key))
        if value:
            return value
    return kind


def _build_event_callback(manager: WebTaskManager, task_id: str):
    """Publish step-level solve/sub-agent events onto the Web task stream.

    The solve engine reports progress through ``on_event``; without this bridge
    the console only ever sees coarse task-level transitions.
    """

    def _callback(kind: str, payload: dict) -> None:
        if kind not in _SOLVE_EVENT_KINDS:
            return
        data = dict(payload or {})
        text = _event_text(kind, data)
        data["text"] = text
        manager.publish(task_id, kind, data)
        phase = data.get("phase")
        manager.update_progress(
            task_id,
            phase=phase if isinstance(phase, str) and phase else None,
            message=text[:200],
        )

    return _callback


def start_task(manager: WebTaskManager, request: TaskCreateRequest) -> str:
    """Create and schedule a new task."""
    record = manager.create_task(request)
    task = asyncio.create_task(_run_task(manager, record.task_id, request))
    manager.bind_runtime_task(record.task_id, task)
    return record.task_id


async def _run_task(manager: WebTaskManager, task_id: str, request: TaskCreateRequest) -> None:
    config = load_config()
    # Web-triggered tasks (including persistent-cycle runs) build prompts and
    # reports outside the CLI, so the configured language must be resolved
    # here before any of that code runs — the CLI does this at its own
    # entrypoints, but this background/orchestrated path has no CLI to do it.
    init_i18n(config=config)
    mcp_manager = MCPLifecycleManager(config)
    mcp_manager.start_enabled_servers()
    agent = AgentCore(config, mcp_manager)

    try:

        def before_restore(_restore_result) -> None:
            if request.resume:
                manager.set_restoring(task_id, snapshot_id=request.snapshot_id)

        def on_restored(restore_result) -> None:
            manager.publish(
                task_id,
                "task_state_changed",
                {
                    "resume": True,
                    "snapshot_id": restore_result.snapshot_id,
                    "phase": restore_result.phase,
                    "resume_strategy": restore_result.resume_strategy,
                    "resume_reason": restore_result.resume_reason,
                },
            )

        def on_legacy_import(restore_result) -> None:
            manager.publish(
                task_id,
                "legacy_import",
                {
                    "target": restore_result.target,
                    "snapshot_id": restore_result.snapshot_id,
                },
            )

        execution = await execute_task(
            agent,
            prepare_task(request),
            before_restore=before_restore,
            on_restored=on_restored,
            on_legacy_import=on_legacy_import,
            before_action=lambda: manager.set_running(task_id),
            on_event=_build_event_callback(manager, task_id),
            on_step=_build_step_callback(manager, task_id),
            on_cycle_step=_build_cycle_step_callback(manager, task_id),
            on_cycle_complete=_build_cycle_complete_callback(manager, task_id),
        )
        _publish_action_result(manager, task_id, execution.action_result)
        manager.set_completed(task_id, latest_message="Task finished", summary=execution.run.summary)
    except asyncio.CancelledError:
        manager.set_stopped(task_id)
        raise
    except Exception as exc:
        manager.set_failed(task_id, str(exc))
    finally:
        mcp_manager.stop_all()


def _build_cycle_step_callback(manager: WebTaskManager, task_id: str):
    def on_cycle_step(round_num: int, cycle_num: int, result) -> None:
        manager.publish(
            task_id,
            "round_output",
            {
                "cycle": cycle_num,
                "round": round_num,
                "phase": result.phase,
                "text": result.output,
            },
        )
        manager.update_progress(task_id, phase=result.phase, message=(result.output or "")[:200])

    return on_cycle_step


def _build_cycle_complete_callback(manager: WebTaskManager, task_id: str):
    def on_cycle_complete(cycle_num: int, cycle_result) -> None:
        manager.publish(
            task_id,
            "cycle_completed",
            {
                "cycle": cycle_num,
                "new_findings": cycle_result.new_findings,
                "report_path": cycle_result.report_path,
            },
        )

    return on_cycle_complete


def _build_step_callback(manager: WebTaskManager, task_id: str):
    def _callback(round_num: int, result) -> None:
        manager.publish(
            task_id,
            "round_output",
            {
                "round": round_num,
                "phase": result.phase,
                "text": result.output,
            },
        )
        manager.update_progress(task_id, phase=result.phase, message=(result.output or "")[:200])

    return _callback


def _publish_action_result(manager: WebTaskManager, task_id: str, result) -> None:
    if isinstance(result, list) and result:
        result = result[-1]
    output = getattr(result, "output", "")
    if not output:
        return
    phase = getattr(result, "phase", None)
    manager.publish(task_id, "round_output", {"phase": phase, "text": output})
    manager.update_progress(task_id, phase=phase, message=output[:200])
