"""Transparent LangChain gateway — sanitize prompts on the way out, rehydrate
replies on the way back, so cloud inference never sees a real Swiss identifier.

Optional. Requires the ``gateway`` extra::

    pip install "sovereign-shield-ch[gateway]"

Wrap any LangChain chat model; call it like the model it wraps::

    from langchain_google_genai import ChatGoogleGenerativeAI
    from sovereign_shield.gateway import ShieldedChatModel

    inner = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.3)
    llm = ShieldedChatModel(inner)

    reply = llm.invoke(
        "Guten Tag, hier ist Hans Muster. Meine AHV-Nummer ist 756.1234.5678.97. "
        "Bitte um Rueckerstattung auf IBAN CH9300762011623852957."
    )
    print(reply.content)          # answer with the real values restored, on-shore
    print(reply.additional_kwargs["sovereign_shield"])  # {'kept_on_shore': 2, 'leftover': []}

The wrapper protects the user text and prepends a system instruction telling the
model to keep the ``[AHV_1]``-style placeholders verbatim. It is deliberately thin
and single-prompt — the point is to show the round-trip, not to re-implement the
full ``BaseChatModel`` surface. Scope is the deterministic core's: structured
identifiers only (see :mod:`sovereign_shield.core`).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

try:
    from langchain_core.language_models import BaseChatModel
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
except ImportError as exc:  # pragma: no cover - exercised only without the extra
    raise ImportError(
        "sovereign_shield.gateway needs LangChain. "
        'Install the extra: pip install "sovereign-shield-ch[gateway]"'
    ) from exc

from sovereign_shield.core import SovereignShield

__all__ = ["DEFAULT_SYSTEM", "ShieldedChatModel"]

# Told to the model so it treats placeholders as opaque stand-ins and echoes them
# back unchanged — otherwise rehydration has nothing to swap.
DEFAULT_SYSTEM = (
    "You are a helpful assistant. Some personal details in the request are shown as "
    "placeholders like [PERSON_1], [AHV_1], [IBAN_1]. Use each placeholder naturally "
    "wherever the real value belongs and keep it EXACTLY as written — never guess, "
    "expand, invent, or drop the bracketed tokens."
)


def _content_to_text(content: str | list[Any]) -> str:
    """Flatten a LangChain message ``content`` (str, or a list of parts) to text."""
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for part in content:
        if isinstance(part, str):
            parts.append(part)
        elif isinstance(part, dict) and part.get("type") == "text":
            parts.append(str(part.get("text", "")))
    return "".join(parts)


class ShieldedChatModel:
    """Wrap a LangChain chat model so every prompt is sanitized before it leaves
    and every reply is rehydrated before it returns.

    Composition, not subclassing: it holds an inner model and a
    :class:`~sovereign_shield.core.SovereignShield`, and exposes :meth:`invoke`.
    Stateless per call (the shield is), so it is safe to share across threads.
    """

    def __init__(
        self,
        inner: BaseChatModel,
        *,
        shield: SovereignShield | None = None,
        system: str | None = DEFAULT_SYSTEM,
    ) -> None:
        self.inner = inner
        self.shield = shield or SovereignShield()
        self.system = system

    def invoke(self, text: str, **kwargs: Any) -> AIMessage:
        """Sanitize ``text`` → call the wrapped model → rehydrate the reply.

        Returns an ``AIMessage`` whose ``content`` has the real values restored.
        ``additional_kwargs["sovereign_shield"]`` carries ``kept_on_shore`` (how
        many identifiers were tokenized) and ``leftover`` (placeholders the model
        mangled and left unrestored — empty is clean).
        """
        safe, ctx = self.shield.sanitize(text)
        messages: Sequence[Any] = [
            *([SystemMessage(content=self.system)] if self.system else []),
            HumanMessage(content=safe),
        ]
        raw = self.inner.invoke(messages, **kwargs)
        restored = self.shield.rehydrate(_content_to_text(raw.content), ctx)
        return AIMessage(
            content=restored.text,
            additional_kwargs={
                "sovereign_shield": {
                    "kept_on_shore": ctx.total,
                    "leftover": list(restored.leftover),
                }
            },
        )
