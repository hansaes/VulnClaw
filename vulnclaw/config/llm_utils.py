"""LLM utility functions — shared across all layers.

修改者: Nyaecho
修改时间: 2026-07-08
修改原因: 消除 V2 残留 — build_chat_completion_kwargs 原依赖 AgentContext 协议，
         此处重构为接受 llm_config 对象的纯函数，消除 agent/ 依赖。
"""

from __future__ import annotations

import re
from typing import Any


def _is_openai_reasoning_model(provider: str, model: str) -> bool:
    """Return True for OpenAI models that use the newer reasoning parameter set."""
    if provider.lower() != "openai":
        return False
    normalized = model.lower()
    return normalized.startswith(("o1", "o3", "o4", "gpt-5"))


#: Models whose names mark them as GPT-family reasoning models, matched on any
#: OpenAI-compatible provider (e.g. a self-hosted relay serving ``gpt-6.1-sol``).
_REASONING_MODEL_NAME = re.compile(r"^(gpt-|o[1345]|codex)", re.IGNORECASE)

#: Providers that front a GPT-family reasoning model and accept the effort
#: parameter alongside the legacy ``max_tokens`` field.
_REASONING_EFFORT_PROVIDERS = frozenset({"openai", "custom"})


def _accepts_reasoning_effort(provider: str, model: str) -> bool:
    """Whether ``reasoning_effort`` may be sent for this provider/model pair.

    OpenAI's newer reasoning families take the parameter natively.  A custom
    OpenAI-compatible relay fronting a GPT-family reasoning model accepts it
    too, but it may still expect the legacy ``max_tokens`` field - so this
    gate only unlocks the effort parameter and leaves the token-field switch
    to ``_is_openai_reasoning_model``.
    """
    if _is_openai_reasoning_model(provider, model):
        return True
    if provider.lower() not in _REASONING_EFFORT_PROVIDERS:
        return False
    return bool(_REASONING_MODEL_NAME.match(model))


def build_chat_completion_kwargs(
    llm_config: Any,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> dict[str, Any]:
    """Build provider-compatible Chat Completions kwargs.

    OpenAI reasoning/GPT-5 models reject the legacy max_tokens field and expect
    max_completion_tokens instead. Other OpenAI-compatible providers may still
    require the older field, so keep the switch scoped to OpenAI's newer model
    families.

    Args:
        llm_config: An object with attributes: provider, model, max_tokens,
                    temperature, reasoning_effort (typically config.llm).
        messages: Chat messages list.
        tools: Optional OpenAI tool schemas.
        max_tokens: Override for max tokens.
        temperature: Override for temperature.
    """
    provider = str(getattr(llm_config, "provider", "") or "").lower()
    model = str(getattr(llm_config, "model", "") or "")
    token_limit = max_tokens if max_tokens is not None else getattr(llm_config, "max_tokens", None)
    temp = temperature if temperature is not None else getattr(llm_config, "temperature", None)
    uses_reasoning_params = _is_openai_reasoning_model(provider, model)

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
    }
    if token_limit is not None:
        if uses_reasoning_params:
            kwargs["max_completion_tokens"] = token_limit
        else:
            kwargs["max_tokens"] = token_limit
    if temp is not None and not uses_reasoning_params:
        kwargs["temperature"] = temp
    if tools:
        kwargs["tools"] = tools
    reasoning_effort = getattr(llm_config, "reasoning_effort", None)
    if reasoning_effort and _accepts_reasoning_effort(provider, model):
        kwargs["reasoning_effort"] = reasoning_effort
    return kwargs
