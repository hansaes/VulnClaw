"""Task orchestration service for the Web UI backend."""

from __future__ import annotations

import asyncio
import time

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


#: Batch thresholds for the web stream sink: one SSE event (and one task-state
#: write) covers many provider tokens.
_STREAM_FLUSH_SECONDS = 0.8
_STREAM_FLUSH_CHARS = 600
_STREAM_TEXT_LIMIT = 4000


class _WebStreamSink:
    """StreamSink that forwards model output onto the Web task stream.

    Runs that pass a sink use the streaming call path, so the console receives
    reasoning, content and tool deltas while a turn is still generating instead
    of only after it finishes. Deltas are batched so the event stream and the
    persisted task state are not rewritten once per token.

    Note: this is a visibility change, not a reliability fix. The intermittent
    provider timeouts seen here hit the streaming and non-streaming paths alike
    (measured 5/10 vs 6/10 call failures at a fixed ~16-19s), so the retry
    tolerance in ``vulnclaw.agent.solver`` is what keeps runs alive.
    """

    def __init__(self, manager: WebTaskManager, task_id: str) -> None:
        self._manager = manager
        self._task_id = task_id
        self._buffers: dict[str, list[str]] = {}
        self._last_flush = time.monotonic()

    def _push(self, kind: str, text: str) -> None:
        if not text:
            return
        parts = self._buffers.setdefault(kind, [])
        parts.append(text)
        if sum(len(part) for part in parts) >= _STREAM_FLUSH_CHARS or (
            time.monotonic() - self._last_flush >= _STREAM_FLUSH_SECONDS
        ):
            self.flush()

    def flush(self) -> None:
        """Publish whatever is buffered; called on size, time and stream end."""
        self._last_flush = time.monotonic()
        for kind, parts in list(self._buffers.items()):
            text = "".join(parts)
            self._buffers[kind] = []
            if text:
                self._manager.publish(
                    self._task_id,
                    "agent_stream",
                    {"type": kind, "text": text[-_STREAM_TEXT_LIMIT:]},
                )

    # ── StreamSink protocol ──────────────────────────────────────────────
    def on_status(self, message: str) -> None:
        self.flush()
        self._manager.publish(
            self._task_id, "agent_status", {"message": str(message or "")[:200]}
        )

    def on_thinking_token(self, token: str) -> None:
        self._push("reasoning", token)

    def on_content_token(self, token: str) -> None:
        self._push("content", token)

    def on_tool_call(self, tool_name: str, args: str) -> None:
        self.flush()
        self._manager.publish(
            self._task_id, "agent_tool", {"tool": str(tool_name), "args": str(args)[:1000]}
        )

    def on_tool_result(self, result_summary: str) -> None:
        self.flush()
        text = str(result_summary or "").strip()
        if text:
            self._manager.publish(
                self._task_id, "agent_tool_result", {"result": text[:1500]}
            )

    def on_stream_end(self) -> None:
        self.flush()


def start_task(manager: WebTaskManager, request: TaskCreateRequest) -> str:
    """Create and schedule a new task."""
    record = manager.create_task(request)
    task = asyncio.create_task(_run_task(manager, record.task_id, request))
    manager.bind_runtime_task(record.task_id, task)
    return record.task_id


async def _run_task(manager: WebTaskManager, task_id: str, request: TaskCreateRequest) -> None:
    config = load_config()
    # A Web task has no human attached: an ASK_USER would end the run with nobody
    # able to answer it, so let the solve loop resolve such questions itself.
    config.session.headless_autonomy = True
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
            stream_sink=_WebStreamSink(manager, task_id),
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
