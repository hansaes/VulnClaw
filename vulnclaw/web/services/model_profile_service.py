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
    }


def list_model_profiles() -> dict[str, Any]:
    config = load_config()
    return {
        "profiles": [_public(p) for p in config.llm.model_profiles],
        "active_id": config.llm.active_model_profile_id or "",
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
    )
    if not profile.model:
        raise ValueError("model is required")
    config.llm.model_profiles.append(profile)
    # First profile becomes active automatically.
    if len(config.llm.model_profiles) == 1:
        _apply(config, profile)
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
    if config.llm.active_model_profile_id == profile_id:
        _apply(config, profile)
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


def activate_model_profile(profile_id: str) -> dict[str, Any] | None:
    config = load_config()
    profile = _find(config, profile_id)
    if not profile:
        return None
    _apply(config, profile)
    save_config(config)
    return _public(profile)
