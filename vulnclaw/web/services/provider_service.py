"""Provider preset + model-listing service for the Web UI backend.

Powers the Settings page dropdowns: the static list of provider presets
(provider / base URL) and a live "list models" call that reuses the saved
API key server-side (the key is never sent to the browser).
"""

from __future__ import annotations

from vulnclaw.config.schema import PROVIDER_PRESETS, LLMProvider
from vulnclaw.config.settings import fetch_provider_models, load_config
from vulnclaw.web.schemas import (
    ProviderModelsRequest,
    ProviderModelsResponse,
    ProviderPresetView,
    ProvidersView,
)


def get_provider_presets() -> ProvidersView:
    """Return the built-in provider presets for the Settings dropdowns."""
    providers = [
        ProviderPresetView(
            id=provider.value,
            label=str(preset.get("label", provider.value)),
            base_url=str(preset.get("base_url", "")),
            default_model=str(preset.get("default_model", "")),
        )
        for provider, preset in PROVIDER_PRESETS.items()
    ]
    return ProvidersView(providers=providers)


def _resolve_base_url(request: ProviderModelsRequest, config_base_url: str) -> str:
    """Pick the base URL to query: request override > provider preset > config."""
    explicit = (request.base_url or "").strip()
    if explicit:
        return explicit
    if request.provider:
        try:
            preset = PROVIDER_PRESETS.get(LLMProvider(request.provider.lower()))
        except ValueError:
            preset = None
        if preset and preset.get("base_url"):
            return str(preset["base_url"])
    return config_base_url


def _normalize_base_url(value: str) -> str:
    return value.strip().rstrip("/").lower()


def _matches_saved_credential_scope(
    request: ProviderModelsRequest,
    base_url: str,
    saved_provider: str,
    saved_base_url: str,
) -> bool:
    """Return whether the request targets the saved credential's provider and URL."""
    requested_provider = (request.provider or saved_provider).strip().lower()
    requested_base_url = _normalize_base_url(base_url)
    return (
        bool(requested_provider)
        and requested_provider == saved_provider.strip().lower()
        and bool(requested_base_url)
        and requested_base_url == _normalize_base_url(saved_base_url)
    )


def preview_models(api_key: str, base_url: str, provider: str | None) -> ProviderModelsResponse:
    """List models with a one-shot user-supplied key (never persisted).

    Unlike :func:`fetch_models`, the key comes from the request body and is
    used only for this single ``/models`` call. The base URL must already be
    validated as http(s) by the request schema.
    """
    resolved = (base_url or "").strip()
    if not resolved and provider:
        try:
            preset = PROVIDER_PRESETS.get(LLMProvider(provider.lower()))
        except ValueError:
            preset = None
        if preset and preset.get("base_url"):
            resolved = str(preset["base_url"])
    key = (api_key or "").strip()
    if not resolved or not key:
        return ProviderModelsResponse(
            base_url=resolved,
            models=[],
            has_api_key=bool(key),
            detail="需要接口地址和 API Key 才能获取模型列表。",
        )
    models = fetch_provider_models(resolved, key)
    detail = "" if models else "未能获取到模型列表，请检查接口地址与 Key 是否正确。"
    return ProviderModelsResponse(
        base_url=resolved,
        models=models,
        has_api_key=True,
        detail=detail,
    )


def fetch_models(request: ProviderModelsRequest) -> ProviderModelsResponse:
    """List models for a provider/base URL using the saved API key.

    The key is read from the saved config (never accepted from the browser),
    and is only sent when both the requested provider and base URL match the
    saved configuration. This prevents cross-provider credential disclosure
    and SSRF-style exfiltration through a spoofed base URL.
    Returns an empty list with a hint when no key is configured.
    """
    config = load_config()
    base_url = _resolve_base_url(request, config.llm.base_url)
    api_key = config.llm.primary_key()

    if not api_key:
        return ProviderModelsResponse(
            base_url=base_url,
            models=[],
            has_api_key=False,
            detail="No API key configured. Save your API key first, then refresh.",
        )

    if not _matches_saved_credential_scope(
        request,
        base_url,
        config.llm.provider,
        config.llm.base_url,
    ):
        return ProviderModelsResponse(
            base_url=base_url,
            models=[],
            has_api_key=True,
            detail=(
                "The requested provider and base URL don't match the saved provider "
                "configuration, so the saved API key won't be sent. Save it first, "
                "then refresh."
            ),
        )

    models = fetch_provider_models(base_url, api_key)
    detail = "" if models else "The provider returned no models (check the base URL / key)."
    return ProviderModelsResponse(
        base_url=base_url,
        models=models,
        has_api_key=True,
        detail=detail,
    )
