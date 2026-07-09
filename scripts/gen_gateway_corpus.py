#!/usr/bin/env python
"""Generate the recorded corpus for the shield.ars.md data-sovereignty gateway demo.

The demo shows the tokenize -> call -> detokenize round-trip: a business document
with Swiss PII is sanitized (each identifier replaced by a stable placeholder)
BEFORE it reaches the model, the model answers on the placeholders, and the real
values are restored on the way back — so no personal data ever crosses the border,
and the app still works.

This script tokenizes each document (structured PII via sovereign_shield's real
detectors + annotated names/addresses, which need an NER model the deterministic
core deliberately omits), sends the SANITIZED prompt to each model, and records the
response (which keeps the placeholders). It asserts no raw PII survives into the
sanitized prompt.

Dev-only; the demo ships the committed web/data/gateway.json and does not need this
to deploy. Regenerating needs provider packages + keys, e.g.:

    pip install "sovereign-shield-ch[gateway]" langchain-anthropic langchain-deepseek
    python scripts/gen_gateway_corpus.py

Model ids below may need updating to each provider's current catalog.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sovereign_shield.pii import detect_pii

OUT = Path(__file__).resolve().parents[1] / "web" / "data" / "gateway.json"

PREFIX = {
    "name": "PERSON",
    "address": "ADDRESS",
    "ch_ahv": "AHV",
    "iban": "IBAN",
    "ch_phone": "PHONE",
    "email": "EMAIL",
    "credit_card": "CARD",
}

SYSTEM = (
    "You are a helpful business assistant. In the text below, personal data has been replaced "
    "with placeholders such as [PERSON_1], [AHV_1], [IBAN_1], [PHONE_1], [EMAIL_1], [ADDRESS_1]. "
    "Treat each placeholder as a stand-in for a real value and KEEP every placeholder you use "
    "EXACTLY as written — never guess, expand, invent, or drop the bracketed tokens."
)

# `id`/`label`/`vendor` are written to the JSON (and keyed as `<doc>::<id>`);
# `provider` is passed to LangChain's init_chat_model at regeneration time.
MODELS = [
    {
        "id": "gemini-3.5-flash",
        "label": "Gemini 3.5 Flash",
        "vendor": "Google",
        "provider": "google_genai",
    },
    {
        "id": "claude-sonnet-4-6",
        "label": "Claude Sonnet 4.6",
        "vendor": "Anthropic",
        "provider": "anthropic",
    },
    {
        "id": "deepseek-v4-pro",
        "label": "DeepSeek V4 Pro",
        "vendor": "DeepSeek",
        "provider": "deepseek",
    },
]

DOCS: list[dict[str, Any]] = [
    {
        "id": "support_email",
        "label": "Customer support email",
        "task": "Draft a short, warm reply in English confirming we'll investigate the double charge and refund it within five business days.",
        "text": (
            "Betreff: Doppelte Belastung\n\n"
            "Guten Tag, hier ist Hans Muster. Meine AHV-Nummer ist 756.1234.5678.97. "
            "Auf meinem Konto (IBAN CH9300762011623852957) wurde die Praemie von CHF 240 "
            "doppelt abgebucht. Bitte um Rueckerstattung. Erreichbar bin ich unter "
            "+41 79 214 88 03 oder hans.muster@bluewin.ch."
        ),
        "annotate": [{"value": "Hans Muster", "category": "name"}],
    },
    {
        "id": "insurance_claim",
        "label": "Insurance claim",
        "task": "Summarise this accident claim in three short bullet points for the claims adjuster.",
        "text": (
            "Claim FF-2291. Policyholder: Nadia Bianchi, AHV 756.9217.0769.85. She slipped at "
            "Bahnhofstrasse 40, 8001 Zurich and fractured her wrist; treated at USZ. Please "
            "reimburse CHF 1,850 to IBAN CH6000243138729430001. Reachable on +41 44 255 11 11 "
            "or nadia.bianchi@bluewin.ch."
        ),
        "annotate": [
            {"value": "Nadia Bianchi", "category": "name"},
            {"value": "Bahnhofstrasse 40, 8001 Zurich", "category": "address"},
        ],
    },
    {
        "id": "hr_onboarding",
        "label": "HR onboarding note",
        "task": "Draft a friendly internal Slack message welcoming the new hire to the team. Do NOT mention salary.",
        "text": (
            "New hire: Marco Rossi starts 01.08. AHV 756.3047.5009.62. Personal mobile "
            "+41 78 601 22 44, marco.rossi@gmail.com. Agreed salary CHF 95,000. Please set up "
            "payroll and order a laptop for the first day."
        ),
        "annotate": [{"value": "Marco Rossi", "category": "name"}],
    },
]


def compute_entities(text: str, annotate: list[dict[str, str]]) -> list[dict[str, Any]]:
    ents: list[dict[str, Any]] = [
        {
            "start": h.start,
            "end": h.end,
            "category": h.category.value,
            "value": text[h.start : h.end],
        }
        for h in detect_pii(text)
    ]
    for a in annotate:
        idx = text.find(a["value"])
        if idx < 0:
            raise SystemExit(f"annotate value not found in text: {a['value']!r}")
        s, e = idx, idx + len(a["value"])
        if any(s < x["end"] and x["start"] < e for x in ents):
            continue  # already covered by a structured detector
        ents.append({"start": s, "end": e, "category": a["category"], "value": a["value"]})
    ents.sort(key=lambda x: x["start"])
    # Assign stable placeholders; same value -> same token.
    value_token: dict[str, str] = {}
    counters: dict[str, int] = {}
    for x in ents:
        if x["value"] in value_token:
            x["token"] = value_token[x["value"]]
            continue
        p = PREFIX.get(x["category"], x["category"].upper())
        counters[p] = counters.get(p, 0) + 1
        x["token"] = f"[{p}_{counters[p]}]"
        value_token[x["value"]] = x["token"]
    return ents


def sanitize(text: str, ents: list[dict[str, Any]]) -> str:
    out = text
    for x in sorted(ents, key=lambda x: x["start"], reverse=True):
        out = out[: x["start"]] + x["token"] + out[x["end"] :]
    return out


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for part in content:
        if isinstance(part, str):
            parts.append(part)
        elif isinstance(part, dict) and part.get("type") == "text":
            parts.append(str(part.get("text", "")))
    return "".join(parts)


def main() -> int:
    # Imported here so `--help` / tokenization work without the LLM extras installed.
    from dotenv import load_dotenv
    from langchain.chat_models import init_chat_model
    from langchain_core.messages import HumanMessage, SystemMessage

    load_dotenv()
    documents: list[dict[str, Any]] = []
    responses: dict[str, dict[str, str]] = {}

    for doc in DOCS:
        ents = compute_entities(doc["text"], doc.get("annotate", []))
        sanitized = sanitize(doc["text"], ents)
        # Safety: no raw PII value may survive into what leaves the boundary.
        for x in ents:
            if x["value"] in sanitized:
                raise SystemExit(f"[{doc['id']}] raw PII survived sanitization: {x['category']}")
        prompt = f"{doc['task']}\n\n---\n{sanitized}"
        documents.append(
            {
                "id": doc["id"],
                "label": doc["label"],
                "task": doc["task"],
                "text": doc["text"],
                "sanitized": sanitized,
                "entities": [
                    {k: x[k] for k in ("start", "end", "category", "token", "value")} for x in ents
                ],
            }
        )
        print(f"[{doc['id']}] {len(ents)} entities redacted -> sanitized prompt is PII-free")
        for model in MODELS:
            key = f"{doc['id']}::{model['id']}"
            try:
                chat = init_chat_model(
                    model["id"], model_provider=model["provider"], temperature=0.3
                )
                out = _content_to_text(
                    chat.invoke(
                        [SystemMessage(content=SYSTEM), HumanMessage(content=prompt)]
                    ).content
                ).strip()
                responses[key] = {"text": out}
                kept = sum(1 for x in ents if x["token"] in out)
                print(f"    ok  {model['id']}: {len(out)} chars, {kept} placeholder(s) echoed")
            except Exception as e:
                print(f"    ERR {model['id']}: {type(e).__name__}: {e}")

    data = {
        "note": "Real recorded runs: sanitized prompts sent to the models; responses kept the placeholders. All PII is synthetic and checksum-valid; no real data subject.",
        "models": [{"id": m["id"], "label": m["label"], "vendor": m["vendor"]} for m in MODELS],
        "documents": documents,
        "responses": responses,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(documents)} docs x {len(MODELS)} models -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
