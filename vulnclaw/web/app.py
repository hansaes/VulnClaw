"""FastAPI app entry for the VulnClaw Web UI backend."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

from vulnclaw.web.auth import (
    SESSION_COOKIE,
    AuthMiddleware,
    attach_session_cookie,
    create_session,
    destroy_session,
    password_auth_enabled,
    verify_credentials,
    verify_session,
    verify_token,
)
from vulnclaw.web.schemas import (
    ChatMessageRequest,
    ConfigUpdateRequest,
    DualModelRequest,
    LessonCreateRequest,
    LoginRequest,
    ModelProfileRequest,
    ModelProfileRoleRequest,
    ProviderModelsPreviewRequest,
    ProviderModelsRequest,
    ReportGenerateRequest,
    TaskCreateRequest,
)
from vulnclaw.web.services.chat_service import parse_message
from vulnclaw.web.services.config_service import get_public_config, update_public_config
from vulnclaw.web.services.constraint_audit_service import get_constraint_audit
from vulnclaw.web.services.mcp_service import get_mcp_diagnostics
from vulnclaw.web.services.memory_service import (
    approve_lesson,
    create_lesson,
    delete_lesson,
    list_lessons,
    memory_summary,
)
from vulnclaw.web.services.model_profile_service import (
    activate_model_profile,
    create_model_profile,
    delete_model_profile,
    list_model_profiles,
    set_dual_model_enabled,
    set_profile_role,
    update_model_profile,
)
from vulnclaw.web.services.provider_service import fetch_models, get_provider_presets, preview_models
from vulnclaw.web.services.report_service import (
    generate_target_report,
    list_reports,
    read_report_content,
    resolve_report_path,
)
from vulnclaw.web.services.target_service import (
    clear_target,
    get_diff,
    get_preview,
    get_snapshots,
    get_target,
    get_target_raw,
    list_targets,
    rollback_target,
)
from vulnclaw.web.services.task_service import start_task
from vulnclaw.web.stream import encode_sse
from vulnclaw.web.task_manager import WebTaskManager

try:
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import (
        FileResponse,
        JSONResponse,
        RedirectResponse,
        StreamingResponse,
    )
    from starlette.middleware.base import BaseHTTPMiddleware

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised in CLI dry-run and tests
    FastAPI = None  # type: ignore[assignment]
    HTTPException = RuntimeError  # type: ignore[assignment]
    Request = None  # type: ignore[assignment]
    FileResponse = None  # type: ignore[assignment]
    JSONResponse = None  # type: ignore[assignment]
    RedirectResponse = None  # type: ignore[assignment]
    StreamingResponse = None  # type: ignore[assignment]
    BaseHTTPMiddleware = object  # type: ignore[assignment,misc]
    FASTAPI_AVAILABLE = False


PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = Path(__file__).with_name("static")
FRONTEND_DIST_DIR = PROJECT_ROOT / "frontend" / "dist"
task_manager = WebTaskManager()


def resolve_web_index() -> Path:
    """Return the preferred index file for the Web UI."""
    dist_index = FRONTEND_DIST_DIR / "index.html"
    if dist_index.exists():
        return dist_index
    return STATIC_DIR / "index.html"


def resolve_web_asset(path: str) -> Path:
    """Resolve a frontend asset path from dist or fallback static dir."""
    normalized = path.replace("\\", "/").lstrip("/").strip()
    if not normalized:
        return resolve_web_index()

    for base_dir in (FRONTEND_DIST_DIR, STATIC_DIR):
        candidate = (base_dir / normalized).resolve()
        base_resolved = base_dir.resolve()
        if base_resolved in candidate.parents and candidate.is_file():
            return candidate

    return resolve_web_index()


def _serve_spa(request, file_path: Path):  # type: ignore[no-untyped-def]
    """Serve a frontend file, trading a ``?token=`` query for a session cookie.

    The browser UI cannot send a bearer header (see :mod:`vulnclaw.web.auth`),
    so opening the printed ``/?token=<token>`` URL once is what authenticates
    the session. The token is redirected straight back out of the address bar
    so it does not linger in history or leak through ``Referer``.
    """
    token = request.query_params.get("token", "")
    if token and verify_token(token):
        response = RedirectResponse(
            str(request.url.remove_query_params("token")), status_code=303
        )
        attach_session_cookie(response, token)
        return response
    return FileResponse(file_path)


@contextmanager
def _report_fs_errors():
    """Map report filesystem errors onto HTTP responses (missing -> 404, denied -> 403)."""
    try:
        yield
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def create_app():
    """Create the Web UI backend app."""
    if not FASTAPI_AVAILABLE:
        raise RuntimeError(
            "FastAPI is not installed. Install the web extra first: pip install vulnclaw[web]"
        )

    app = FastAPI(title="VulnClaw Web UI", version="0.4.0")
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(AuthMiddleware)

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "service": "vulnclaw-web"}


    @app.post("/api/auth/login")
    async def login(request: LoginRequest):
        if not password_auth_enabled():
            raise HTTPException(status_code=404, detail="Password login is not configured")
        if not verify_credentials(request.username, request.password):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        token = create_session()
        response = JSONResponse({"ok": True})
        attach_session_cookie(response, token)
        return response

    @app.post("/api/auth/logout")
    async def logout(request: Request):
        token = request.cookies.get(SESSION_COOKIE, "")
        if token:
            destroy_session(token)
        response = JSONResponse({"ok": True})
        response.delete_cookie(SESSION_COOKIE, path="/")
        return response

    @app.get("/api/auth/status")
    async def auth_status(request: Request):
        token = request.cookies.get(SESSION_COOKIE, "")
        return {
            "authenticated": bool(token) and verify_session(token),
            "password_auth_enabled": password_auth_enabled(),
        }


    @app.get("/api/memory/summary")
    async def memory_summary_view():
        return memory_summary()

    @app.get("/api/memory/lessons")
    async def memory_lessons(
        scope: str | None = None,
        target_key: str | None = None,
        status: str | None = None,
    ):
        return list_lessons(scope=scope, target_key=target_key, status=status)

    @app.post("/api/memory/lessons")
    async def memory_lesson_create(request: LessonCreateRequest):
        try:
            return create_lesson(request.model_dump())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/memory/lessons/{lesson_id}")
    async def memory_lesson_delete(lesson_id: str):
        if not delete_lesson(lesson_id):
            raise HTTPException(status_code=404, detail="Lesson not found")
        return {"ok": True, "lesson_id": lesson_id}

    @app.post("/api/memory/lessons/{lesson_id}/approve")
    async def memory_lesson_approve(lesson_id: str):
        lesson = approve_lesson(lesson_id)
        if not lesson:
            raise HTTPException(status_code=404, detail="Lesson not found")
        return lesson


    @app.post("/api/chat/message")
    async def chat_message(request: ChatMessageRequest):
        """Rule-based assistant: start tasks, check progress, summarize findings."""
        parsed = parse_message(request.message)
        zh = parsed.get("zh", True)
        intent = parsed.get("intent")

        def _t(zh_text: str, en_text: str) -> str:
            return zh_text if zh else en_text

        if intent == "start_task":
            target = parsed["target"]
            command = parsed["command"]
            cmd_label = {"scan": _t("扫描", "scan"), "recon": _t("侦察", "recon"),
                         "exploit": _t("漏洞验证", "exploit"), "run": _t("渗透测试", "pentest"),
                         "persistent": _t("持续渗透", "persistent")}.get(command, command)
            task_req = TaskCreateRequest(command=command, target=target, resume=True)
            task_id = start_task(task_manager, task_req)
            return {
                "intent": intent,
                "task_id": task_id,
                "reply": _t(
                    f"已为 {target} 启动{cmd_label}任务（{task_id[:8]}），已载入该域名的历史记忆继续执行。你可以在任务管理页查看实时进度。",
                    f"Started {cmd_label} task on {target} ({task_id[:8]}) with the domain's memory loaded. Watch it live on the Tasks page.",
                ),
            }

        if intent == "task_progress":
            tasks = task_manager.list_tasks()
            running = [x for x in tasks if x.status in ("running", "pending")]
            done = [x for x in tasks if x.status not in ("running", "pending")]
            if not tasks:
                return {"intent": intent, "reply": _t("还没有任务。跟我说「对 example.com 做一次扫描」即可开任务。", "No tasks yet. Say 'scan example.com' to start one.")}
            lines = []
            for x in running:
                lines.append(_t(f"• {x.target}（{x.command}）：{x.status}，阶段 {x.phase or '-'}", f"• {x.target} ({x.command}): {x.status}, phase {x.phase or '-'}"))
            for x in done[:5]:
                lines.append(_t(f"• {x.target}（{x.command}）：{x.status}", f"• {x.target} ({x.command}): {x.status}"))
            head = _t(f"当前 {len(running)} 个任务进行中，共 {len(tasks)} 个任务：", f"{len(running)} running, {len(tasks)} total:")
            return {"intent": intent, "reply": head + "\n" + "\n".join(lines)}

        if intent == "task_list":
            tasks = task_manager.list_tasks()[:10]
            if not tasks:
                return {"intent": intent, "reply": _t("任务列表是空的。", "No tasks.")}
            lines = [_t(f"• {x.target}（{x.command}）：{x.status}", f"• {x.target} ({x.command}): {x.status}") for x in tasks]
            return {"intent": intent, "reply": "\n".join(lines)}

        if intent == "vuln_summary":
            target = parsed.get("target")
            if target:
                view = get_target(target)
                if not view:
                    return {"intent": intent, "reply": _t(f"没找到 {target} 的记录，先对它跑一次任务吧。", f"No record for {target} yet — run a task on it first.")}
                n = view.findings_count or 0
                return {"intent": intent, "reply": _t(f"{target} 共发现 {n} 个漏洞，去漏洞管理页查看详情。", f"{target} has {n} findings — see the Findings page for details.")}
            targets = list_targets()
            total = sum(x.findings_count or 0 for x in targets)
            lines = [_t(f"• {x.target}：{x.findings_count or 0} 个", f"• {x.target}: {x.findings_count or 0}") for x in targets[:10] if (x.findings_count or 0) > 0]
            body = "\n".join(lines) if lines else _t("暂无漏洞记录。", "No findings recorded.")
            return {"intent": intent, "reply": _t(f"共 {total} 个漏洞：\n{body}", f"{total} findings total:\n{body}")}

        if intent == "help":
            return {"intent": intent, "reply": _t(
                "我可以帮你：\n• 开任务：「对 example.com 做一次扫描」\n• 查进度：「任务进度怎么样」\n• 查漏洞：「example.com 有哪些漏洞」",
                "I can:\n• Start tasks: 'scan example.com'\n• Check progress: 'progress'\n• Summarize findings: 'vulns on example.com'",
            )}

        return {"intent": "unknown", "reply": _t(
            "我没理解。试试：「对 example.com 做一次扫描」「任务进度怎么样」「example.com 有哪些漏洞」",
            "I didn't get that. Try: 'scan example.com', 'progress', or 'vulns on example.com'.",
        )}


    @app.get("/api/model-profiles")
    async def model_profiles():
        return list_model_profiles()

    @app.post("/api/model-profiles")
    async def model_profile_create(request: ModelProfileRequest):
        try:
            return create_model_profile(request.model_dump(exclude_none=True))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.patch("/api/model-profiles/{profile_id}")
    async def model_profile_update(profile_id: str, request: ModelProfileRequest):
        profile = update_model_profile(profile_id, request.model_dump(exclude_none=True))
        if not profile:
            raise HTTPException(status_code=404, detail="Model profile not found")
        return profile

    @app.delete("/api/model-profiles/{profile_id}")
    async def model_profile_delete(profile_id: str):
        if not delete_model_profile(profile_id):
            raise HTTPException(status_code=404, detail="Model profile not found")
        return {"ok": True}

    @app.post("/api/model-profiles/{profile_id}/activate")
    async def model_profile_activate(profile_id: str):
        profile = activate_model_profile(profile_id)
        if not profile:
            raise HTTPException(status_code=404, detail="Model profile not found")
        return profile

    @app.patch("/api/model-profiles/{profile_id}/role")
    async def model_profile_role(profile_id: str, request: ModelProfileRoleRequest):
        try:
            profile = set_profile_role(profile_id, request.role)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not profile:
            raise HTTPException(status_code=404, detail="Model profile not found")
        return profile

    @app.post("/api/model-profiles/dual-model")
    async def model_profiles_dual_model(request: DualModelRequest):
        return set_dual_model_enabled(request.enabled)

    @app.get("/api/config")
    async def config_view():
        return get_public_config().model_dump(mode="json")

    @app.get("/api/mcp")
    async def mcp_view():
        return get_mcp_diagnostics().model_dump(mode="json")

    @app.get("/api/constraint-audit")
    async def constraint_audit_view():
        return get_constraint_audit().model_dump(mode="json")

    @app.post("/api/config")
    async def config_update(request: ConfigUpdateRequest):
        return update_public_config(request).model_dump(mode="json")

    @app.get("/api/providers")
    async def providers_view():
        return get_provider_presets().model_dump(mode="json")

    @app.post("/api/provider-models")
    async def provider_models_view(request: ProviderModelsRequest):
        return fetch_models(request).model_dump(mode="json")

    @app.post("/api/provider-models/preview")
    async def provider_models_preview(request: ProviderModelsPreviewRequest):
        import asyncio

        result = await asyncio.to_thread(
            preview_models, request.api_key, request.base_url or "", request.provider
        )
        return result.model_dump(mode="json")

    @app.get("/api/tasks")
    async def tasks():
        return [item.model_dump(mode="json") for item in task_manager.list_tasks()]

    @app.post("/api/tasks/run")
    async def create_task(request: TaskCreateRequest):
        task_id = start_task(task_manager, request)
        record = task_manager.get_task(task_id)
        return record.model_dump(mode="json") if record else {"task_id": task_id}

    @app.get("/api/tasks/{task_id}")
    async def task_detail(task_id: str):
        record = task_manager.get_task(task_id)
        if not record:
            raise HTTPException(status_code=404, detail="Task not found")
        return record.model_dump(mode="json")

    @app.post("/api/tasks/{task_id}/stop")
    async def stop_task(task_id: str):
        ok = await task_manager.stop_task(task_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Task not running")
        return {"status": "stopped", "task_id": task_id}

    @app.get("/api/tasks/{task_id}/stream")
    async def stream_task(task_id: str):
        if not task_manager.get_task(task_id):
            raise HTTPException(status_code=404, detail="Task not found")

        async def event_iter():
            async for item in task_manager.stream_events(task_id):
                yield encode_sse(item)

        return StreamingResponse(event_iter(), media_type="text/event-stream")

    @app.get("/api/targets")
    async def targets():
        return [item.model_dump(mode="json") for item in list_targets()]

    @app.get("/api/targets/{target:path}")
    async def target_detail(target: str):
        item = get_target(target)
        if not item:
            raise HTTPException(status_code=404, detail="Target not found")
        return item.model_dump(mode="json")

    @app.get("/api/targets/{target:path}/raw")
    async def target_raw(target: str):
        raw = get_target_raw(target)
        if not raw:
            raise HTTPException(status_code=404, detail="Target not found")
        return JSONResponse(raw)

    @app.get("/api/target-preview/{target:path}")
    async def target_preview(target: str, snapshot_id: str | None = None):
        item = get_preview(target, snapshot_id=snapshot_id)
        if not item:
            raise HTTPException(status_code=404, detail="Target or snapshot not found")
        return item.model_dump(mode="json")

    @app.get("/api/targets/{target:path}/snapshots")
    async def target_snapshots(target: str):
        return [item.model_dump(mode="json") for item in get_snapshots(target)]

    @app.get("/api/target-diff/{target:path}")
    async def target_diff(target: str, from_snapshot_id: str, to_snapshot_id: str | None = None):
        item = get_diff(target, from_snapshot_id=from_snapshot_id, to_snapshot_id=to_snapshot_id)
        if not item:
            raise HTTPException(status_code=404, detail="Snapshot or target state not found")
        return item.model_dump(mode="json")

    @app.post("/api/targets/{target:path}/rollback")
    async def target_rollback(target: str, payload: dict):
        snapshot_id = str(payload.get("snapshot_id", "")).strip()
        if not snapshot_id:
            raise HTTPException(status_code=400, detail="snapshot_id is required")
        if not rollback_target(target, snapshot_id):
            raise HTTPException(status_code=404, detail="Snapshot not found")
        return {"status": "ok", "target": target, "snapshot_id": snapshot_id}

    @app.delete("/api/targets/{target:path}")
    async def target_clear(target: str):
        if not clear_target(target):
            raise HTTPException(status_code=404, detail="Target not found")
        return {"status": "ok", "target": target}

    @app.get("/api/reports")
    async def reports():
        return list_reports()

    @app.get("/api/reports/content")
    async def report_content(path: str):
        with _report_fs_errors():
            content = read_report_content(path)
        return content.model_dump(mode="json")

    @app.get("/api/reports/download")
    async def report_download(path: str):
        with _report_fs_errors():
            report_path = resolve_report_path(path)
        media_type = "text/html" if report_path.suffix.lower() == ".html" else "text/markdown"
        return FileResponse(report_path, media_type=media_type, filename=report_path.name)

    @app.post("/api/reports/target")
    async def report_target(request: ReportGenerateRequest):
        with _report_fs_errors():
            path = generate_target_report(
                request.target,
                request.output_path,
                request.report_format,
            )
        return {"status": "ok", "path": path}

    @app.get("/")
    async def index(request: Request):
        return _serve_spa(request, resolve_web_index())

    @app.get("/{full_path:path}")
    async def frontend_routes(full_path: str, request: Request):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        return _serve_spa(request, resolve_web_asset(full_path))

    return app


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add conservative browser security headers for the local Web UI."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "connect-src 'self'; "
            "frame-src 'self' about: data: blob:; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'",
        )
        return response
