"""Token- and password-based authentication for the VulnClaw Web UI.

The token is generated once and persisted to ``~/.vulnclaw/web_token``.
All ``/api/`` routes (except ``/api/health``) require a valid
``Authorization: Bearer <token>`` header, a session cookie carrying the same
token, or a loopback peer address.

The cookie exists because the shipped browser UI cannot send a bearer header:
``fetch`` here adds none and an SSE ``EventSource`` cannot attach one at all.
Opening the UI once at ``/?token=<token>`` exchanges the token for an
``HttpOnly``/``SameSite=Strict`` session cookie, which the browser then sends
on every subsequent request including the event stream.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import time
from pathlib import Path

try:
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import JSONResponse

    _HAS_STARLETTE = True
except ImportError:  # pragma: no cover
    _HAS_STARLETTE = False

TOKEN_DIR = Path.home() / ".vulnclaw"
TOKEN_FILE = TOKEN_DIR / "web_token"

#: Name of the session cookie that carries the bearer token for browser clients.
SESSION_COOKIE = "vulnclaw_session"


def _token_path() -> Path:
    """Return the token file path, ensuring the parent directory exists."""
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    return TOKEN_FILE


def generate_token() -> str:
    """Return a persisted bearer token.

    If a token file already exists its content is reused.  Otherwise a new
    32-byte URL-safe token is generated, written to disk and returned.
    """
    path = _token_path()
    if path.exists():
        existing = path.read_text(encoding="utf-8").strip()
        if existing:
            return existing

    token = secrets.token_urlsafe(32)
    path.write_text(token, encoding="utf-8")
    # Restrict file permissions on POSIX (best-effort on Windows).
    try:
        import os

        os.chmod(path, 0o600)
    except OSError:
        pass
    return token


def verify_token(token: str) -> bool:
    """Return *True* if *token* matches the stored bearer token.

    Uses :func:`hmac.compare_digest` for timing-safe comparison.
    """
    path = _token_path()
    if not path.exists():
        return False
    stored = path.read_text(encoding="utf-8").strip()
    return hmac.compare_digest(stored, token)


CREDENTIALS_FILE = TOKEN_DIR / "web_credentials.json"

#: In-memory server-side sessions: token -> expiry unix timestamp.
_SESSIONS: dict[str, float] = {}
_SESSION_TTL_SECONDS = 7 * 24 * 3600


def _load_credentials() -> tuple[str, str, bool] | None:
    """Return ``(username, secret, is_sha256)`` or *None* if not configured.

    Credentials come from ``VULNCLAW_WEB_USERNAME`` / ``VULNCLAW_WEB_PASSWORD``
    environment variables first, then from ``~/.vulnclaw/web_credentials.json``
    (``{"username": ..., "password_sha256": ...}``).
    """
    username = os.environ.get("VULNCLAW_WEB_USERNAME", "").strip()
    password = os.environ.get("VULNCLAW_WEB_PASSWORD", "")
    if username and password:
        return username, password, False
    path = CREDENTIALS_FILE
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            user = str(data.get("username", "")).strip()
            digest = str(data.get("password_sha256", "")).strip()
            if user and digest:
                return user, digest, True
        except (OSError, ValueError):
            pass
    return None


def password_auth_enabled() -> bool:
    """Whether username/password login is configured."""
    return _load_credentials() is not None


def verify_credentials(username: str, password: str) -> bool:
    """Check a username/password pair against the configured credentials."""
    creds = _load_credentials()
    if creds is None:
        return False
    stored_user, secret, is_sha256 = creds
    if not hmac.compare_digest(stored_user, username.strip()):
        return False
    if is_sha256:
        digest = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(secret, digest)
    return hmac.compare_digest(secret, password)


def create_session() -> str:
    """Create a server-side session token valid for 7 days."""
    token = secrets.token_urlsafe(32)
    _SESSIONS[token] = time.time() + _SESSION_TTL_SECONDS
    return token


def verify_session(token: str) -> bool:
    """Whether *token* is a live server-side session."""
    expiry = _SESSIONS.get(token)
    if not expiry:
        return False
    if expiry < time.time():
        _SESSIONS.pop(token, None)
        return False
    return True


def destroy_session(token: str) -> None:
    """Invalidate a server-side session token."""
    _SESSIONS.pop(token, None)


def web_cookie_secure() -> bool:
    """Whether browser sessions must be limited to HTTPS connections.

    The local UI intentionally supports plain HTTP.  A reverse-proxied VPS
    deployment sets ``VULNCLAW_WEB_COOKIE_SECURE=true`` so a copied session
    cookie cannot be replayed over HTTP.
    """
    return os.environ.get("VULNCLAW_WEB_COOKIE_SECURE", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def attach_session_cookie(response, token: str, *, secure: bool | None = None) -> None:  # type: ignore[no-untyped-def]
    """Store *token* on the browser as an HttpOnly session cookie.

    ``secure`` defaults from ``VULNCLAW_WEB_COOKIE_SECURE``.  Local HTTP keeps
    working by default; the VPS Compose profile enables it after TLS is
    terminated by Caddy. ``SameSite=Strict`` keeps the cookie off cross-site
    requests, guarding state-changing ``/api/`` routes against CSRF.
    """
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="strict",
        path="/",
        secure=web_cookie_secure() if secure is None else secure,
    )


def request_has_valid_session(request) -> bool:  # type: ignore[no-untyped-def]
    """Whether *request* carries a session cookie holding a valid token.

    Accepts both server-side login sessions and the legacy bearer-token
    cookie (``?token=`` exchange), so existing setups keep working.
    """
    cookie = request.cookies.get(SESSION_COOKIE, "")
    if not cookie:
        return False
    return verify_session(cookie) or verify_token(cookie)


def _client_is_loopback(client_host: str | None) -> bool:
    """Whether a request originates from a loopback (local) client.

    The ``web`` command binds to 127.0.0.1 by default and refuses non-loopback
    binds without ``--allow-remote``, so a loopback client is the trusted local
    operator. Bearer-token auth is therefore enforced only for **non-loopback**
    clients (the explicit ``--allow-remote`` case). This is what lets the
    same-origin browser UI work locally: native ``fetch`` here sends no bearer
    header and an SSE ``EventSource`` cannot attach one at all, so requiring a
    token on loopback would 401 the entire shipped frontend.

    Note: this trusts the peer address, so a reverse proxy on localhost would
    appear loopback. Defending a localhost bind against DNS-rebinding wants a
    ``Host`` header allowlist, which is a separate hardening step.
    """
    if not client_host:
        return False  # unknown origin — require auth
    try:
        return ipaddress.ip_address(client_host).is_loopback
    except ValueError:
        return client_host == "localhost"


if _HAS_STARLETTE:

    class AuthMiddleware(BaseHTTPMiddleware):  # type: ignore[no-redef]
        """ASGI middleware that enforces bearer-token auth on ``/api/`` routes.

        ``/api/health`` is always exempt so that uptime probes work without
        credentials.
        """

        # Exact paths — not prefixes — so an added route like /api/healthcheck
        # or /api/health-secret is never accidentally left unauthenticated.
        _EXEMPT_PATHS: frozenset[str] = frozenset({
            "/api/health",
            "/api/auth/login",
            "/api/auth/status",
            "/api/auth/logout",
        })

        async def dispatch(self, request: Request, call_next):  # type: ignore[override]
            path = request.url.path
            client_host = request.client.host if request.client else None
            if (
                path.startswith("/api/")
                and path not in self._EXEMPT_PATHS
                and not _client_is_loopback(client_host)
                and not request_has_valid_session(request)
            ):
                auth_header = request.headers.get("Authorization", "")
                if not auth_header.startswith("Bearer "):
                    return JSONResponse(
                        {"detail": "Missing or malformed Authorization header"},
                        status_code=401,
                    )
                bearer = auth_header[len("Bearer ") :]
                if not verify_token(bearer):
                    return JSONResponse(
                        {"detail": "Invalid token"},
                        status_code=403,
                    )
            return await call_next(request)

else:  # pragma: no cover

    class AuthMiddleware:  # type: ignore[no-redef]
        """Stub raised when Starlette is not installed."""

        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise RuntimeError(
                "Starlette is not installed. Install the web extra: "
                "pip install vulnclaw[web]"
            )
