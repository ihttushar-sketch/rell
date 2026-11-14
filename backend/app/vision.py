"""Optional multimodal vision pass.

Scene cuts, flow and colour are measured numerically; this module adds the
qualitative layer — transition style, on-screen graphics, wardrobe/mood — using
a hosted vision model. It is entirely optional and never blocks production:
with no API key configured, analysis simply skips the step and says so.

Configuration
-------------
NEXUS_VISION_PROVIDER  gemini | openai | off   (default: off)
NEXUS_VISION_API_KEY   provider API key
NEXUS_VISION_MODEL     defaults: gemini-2.5-pro / gpt-4o-mini
"""

from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("nexus.vision")

PROMPT = (
    "You are a senior video editor reverse-engineering a reference edit. "
    "These frames are sampled across the timeline of a short-form video. "
    "Return STRICT JSON only, no markdown, with the keys: "
    '"summary" (one sentence), "editing_style" (max 8 words), '
    '"transition_style" (max 8 words), "motion_graphics" (array of max 4 short strings), '
    '"color_grade" (max 8 words), "tags" (array of max 5 lowercase slugs). '
    "Be concrete and avoid generic praise."
)


def status() -> Dict[str, Any]:
    provider = (os.environ.get("NEXUS_VISION_PROVIDER") or "off").strip().lower()
    key = os.environ.get("NEXUS_VISION_API_KEY", "").strip()
    default_model = {"gemini": "gemini-2.5-pro", "openai": "gpt-4o-mini"}.get(provider, "")
    model = os.environ.get("NEXUS_VISION_MODEL", default_model).strip()
    return {"enabled": provider in {"gemini", "openai"} and bool(key), "provider": provider, "model": model}


def _encode(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _post_json(url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout: float = 90) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", **headers}, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed provider endpoints
        return json.loads(response.read().decode("utf-8"))


def _parse_payload(text: str) -> Optional[Dict[str, Any]]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.lstrip().startswith("json"):
            cleaned = cleaned.lstrip()[4:]
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None


def describe_edit(keyframes: List[Path]) -> Optional[Dict[str, Any]]:
    """Send keyframes to the configured provider. Returns None on any failure."""
    config = status()
    if not config["enabled"] or not keyframes:
        return None
    provider = config["provider"]
    key = os.environ["NEXUS_VISION_API_KEY"].strip()
    model = config["model"]

    try:
        if provider == "gemini":
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": PROMPT},
                            *[
                                {"inline_data": {"mime_type": "image/jpeg", "data": _encode(frame)}}
                                for frame in keyframes
                            ],
                        ]
                    }
                ],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 512},
            }
            response = _post_json(url, payload, {})
            text = (
                response.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
        else:
            url = "https://api.openai.com/v1/chat/completions"
            payload = {
                "model": model,
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": PROMPT},
                            *[
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/jpeg;base64,{_encode(frame)}"},
                                }
                                for frame in keyframes
                            ],
                        ],
                    }
                ],
            }
            response = _post_json(url, payload, {"Authorization": f"Bearer {key}"})
            text = response.get("choices", [{}])[0].get("message", {}).get("content", "")

        parsed = _parse_payload(text or "")
        if not parsed:
            return None
        parsed["provider"] = provider
        parsed["model"] = model
        return parsed
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
        logger.warning("vision pass failed: %s", exc)
        return None


__all__ = ["status", "describe_edit", "PROMPT"]
