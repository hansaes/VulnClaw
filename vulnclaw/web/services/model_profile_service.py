"""Web API service for managing multiple LLM model profiles.

Profiles are stored on ``llm.model_profiles`` in the VulnClaw config file.
Activating a profile copies its provider/model/base_url/api_key into the
live ``llm.*`` fields (what the agent actually reads) and records the
profile id in ``llm.active_model_profile_id``. API keys are never returned
to the browser — only whether one is configured.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from vulnclaw.config.schema import ModelProfileConfig
from vulnclaw.config.settings import load_config, save_config


def _public(profile: ModelProfileConfig) -> dict[str, Any]:
    return {
        "id": profile.id,
        "label": profile.label,
        "provider": profile.provider,
        "model": profile.model,
        "base_url": profile.base_url,
        "api_key_configured": bool(profile.api_key),
        "role": profile.role,
    }


def _validate_role(role: Any) -> str:
    role = (role or "both").strip().lower() if isinstance(role, str) else "both"
    if role not in ("thinking", "execution", "both"):
        raise ValueError("role must be one of: thinking, execution, both")
    return role


def list_model_profiles() -> dict[str, Any]:
    config = load_config()
    thinking_id = ""
    for p in config.llm.model_profiles:
        if p.role == "thinking":
            thinking_id = p.id
            break
    return {
        "profiles": [_public(p) for p in config.llm.model_profiles],
        "active_id": config.llm.active_model_profile_id or "",
        "dual_model_enabled": bool(config.llm.dual_model_enabled),
        "thinking_id": thinking_id,
        "thinking_configured": bool(config.llm.thinking_configured()),
    }


def _find(config, profile_id: str) -> ModelProfileConfig | None:
    for p in config.llm.model_profiles:
        if p.id == profile_id:
            return p
    return None


def create_model_profile(data: dict[str, Any]) -> dict[str, Any]:
    config = load_config()
    profile = ModelProfileConfig(
        id="mp-" + uuid4().hex[:8],
        label=(data.get("label") or "").strip(),
        provider=(data.get("provider") or "openai").strip(),
        model=(data.get("model") or "").strip(),
        base_url=(data.get("base_url") or "").strip(),
        api_key=(data.get("api_key") or ""),
        role=_validate_role(data.get("role")),
    )
    if not profile.model:
        raise ValueError("model is required")
    config.llm.model_profiles.append(profile)
    # First profile becomes active automatically.
    if len(config.llm.model_profiles) == 1:
        _apply(config, profile)
    _sync_role(config, profile)
    save_config(config)
    return _public(profile)


def update_model_profile(profile_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    config = load_config()
    profile = _find(config, profile_id)
    if not profile:
        return None
    if "label" in data:
        profile.label = (data["label"] or "").strip()
    if "provider" in data:
        profile.provider = (data["provider"] or "").strip()
    if "model" in data:
        profile.model = (data["model"] or "").strip()
    if "base_url" in data:
        profile.base_url = (data["base_url"] or "").strip()
    if data.get("api_key"):
        profile.api_key = data["api_key"]
    if "role" in data:
        profile.role = _validate_role(data.get("role"))
    if config.llm.active_model_profile_id == profile_id:
        _apply(config, profile)
    _sync_role(config, profile)
    save_config(config)
    return _public(profile)


def delete_model_profile(profile_id: str) -> bool:
    config = load_config()
    profile = _find(config, profile_id)
    if not profile:
        return False
    config.llm.model_profiles = [p for p in config.llm.model_profiles if p.id != profile_id]
    if config.llm.active_model_profile_id == profile_id:
        config.llm.active_model_profile_id = ""
    if profile.role == "thinking":
        _clear_thinking(config)
    save_config(config)
    return True


def _apply(config, profile: ModelProfileConfig) -> None:
    """Copy a profile into the live llm.* fields the agent reads."""
    config.llm.provider = profile.provider
    config.llm.model = profile.model
    if profile.base_url:
        config.llm.base_url = profile.base_url
    if profile.api_key:
        config.llm.api_key = profile.api_key
    config.llm.active_model_profile_id = profile.id


def _apply_thinking(config, profile: ModelProfileConfig) -> None:
    """Copy a profile into the live llm.thinking_* fields."""
    config.llm.thinking_provider = profile.provider
    config.llm.thinking_model = profile.model
    if profile.base_url:
        config.llm.thinking_base_url = profile.base_url
    if profile.api_key:
        config.llm.thinking_api_key = profile.api_key


def _clear_thinking(config) -> None:
    config.llm.thinking_provider = ""
    config.llm.thinking_model = ""
    config.llm.thinking_base_url = ""
    config.llm.thinking_api_key = ""


def _sync_role(config, profile: ModelProfileConfig) -> None:
    """Sync live fields from a profile according to its dual-model role.

    - thinking: becomes the thinking model (llm.thinking_*), enables dual mode.
    - execution: becomes the execution model (live llm.* fields).
    - both: no live sync here; the activation path handles llm.* sync.
    """
    if profile.role == "thinking":
        _apply_thinking(config, profile)
        # Assigning a thinking model implies dual-model intent.
        config.llm.dual_model_enabled = True
    elif profile.role == "execution":
        _apply(config, profile)


def set_profile_role(profile_id: str, role: str) -> dict[str, Any] | None:
    """Assign a dual-model role to a profile and sync live fields."""
    config = load_config()
    profile = _find(config, profile_id)
    if not profile:
        return None
    role = _validate_role(role)
    was_thinking = profile.role == "thinking"
    # Only one thinking profile at a time: demote the previous one.
    if role == "thinking":
        for p in config.llm.model_profiles:
            if p.id != profile_id and p.role == "thinking":
                p.role = "both"
    profile.role = role
    if was_thinking and role != "thinking":
        _clear_thinking(config)
    _sync_role(config, profile)
    save_config(config)
    return _public(profile)


def set_dual_model_enabled(enabled: bool) -> dict[str, Any]:
    config = load_config()
    config.llm.dual_model_enabled = bool(enabled)
    save_config(config)
    return {
        "dual_model_enabled": bool(config.llm.dual_model_enabled),
        "thinking_configured": bool(config.llm.thinking_configured()),
    }


def activate_model_profile(profile_id: str) -> dict[str, Any] | None:
    config = load_config()
    profile = _find(config, profile_id)
    if not profile:
        return None
    _apply(config, profile)
    save_config(config)
    return _public(profile)
