"""Smart clip matcher + deterministic FFmpeg render engine.

The RenderPlan produced by ``scaler.py`` is compiled into a single complex
filtergraph:

  per slot   trim → fps normalise → cover-scale/crop → Ken-Burns (zoompan)
             → grade (eq / colorbalance / vignette) → per-cut fade/xfade accents
  timeline   concat (exact durations, zero drift)
  brand      drawtext watermark locked to TOP-LEFT 24:24
  audio      framework/custom BGM loop → optional SFX stem → amix → EBU R128

Exact timing is treated as non-negotiable: transition accents are rendered as
per-segment fades rather than overlapping xfades, so a 30.000s brief stays
30.000s instead of drifting by 0.2s per join.
"""

from __future__ import annotations

import math
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .capabilities import hardware_accel
from .clips import Window, speech_windows
from .config import RENDER_DIR, RENDER_FPS, RENDER_MAX_DIM
from .ffmpeg import (
    FFmpegError,
    MediaInfo,
    extract_frame,
    filter_script_flag,
    probe,
    require_ffmpeg,
    run_ffmpeg,
    video_encoder_args,
    watermark_filter,
)
from .jobs import Job

ASPECT_SIZES = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080), "4:5": (1080, 1350)}
GOLDEN = 0.6180339887


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _even(value: int) -> int:
    return max(2, int(value) - int(value) % 2)


def output_size(aspect: str) -> Tuple[int, int]:
    width, height = ASPECT_SIZES.get(aspect, ASPECT_SIZES["9:16"])
    scale = min(1.0, RENDER_MAX_DIM / float(max(width, height)))
    return _even(round(width * scale)), _even(round(height * scale))


def _media_url(path: Path) -> str:
    from .config import DATA_DIR

    try:
        relative = path.resolve().relative_to(DATA_DIR.resolve())
    except ValueError:
        relative = Path(path.name)
    return f"/api/files/{relative.as_posix()}"


def _pick_segment(
    clip: MediaInfo,
    slot_duration: float,
    index: int,
    src_shot: int,
    windows: Optional[Sequence[Window]] = None,
) -> Tuple[str, float]:
    """Pick where inside a raw clip this slot is sourced from.

    Speech windows (VAD) bound the usable pool so dead air never reaches the
    edit; within the chosen window a golden-ratio walk avoids reusing frames.
    """
    ratio = ((index * GOLDEN) + (src_shot % 7) / 7.0) % 1.0
    candidates = [window for window in (windows or []) if window[1] - window[0] >= min(0.3, slot_duration)]
    if candidates:
        longest = max(candidates, key=lambda window: window[1] - window[0])
        start, end = candidates[index % len(candidates)] if len(candidates) > 1 else longest
        usable = max(0.0, (end - start) - slot_duration - 0.05)
        return clip.path, round(start + ratio * usable, 4)
    usable = max(0.0, (clip.duration or 0.0) - slot_duration - 0.08)
    return clip.path, round(ratio * usable, 4)


def _zoompan(slot: Dict[str, Any], width: int, height: int, fps: int) -> str:
    frames = max(1, round(float(slot["duration"]) * fps))
    motion = slot.get("motion", "static")
    zoom_from = float(slot.get("zoom_from", 1.0))
    zoom_to = float(slot.get("zoom_to", 1.0))
    pan = slot.get("pan") or {}
    pan_x = float(pan.get("x", 0.0))
    pan_y = float(pan.get("y", 0.0))

    if abs(zoom_to - zoom_from) > 0.001:
        delta = zoom_to - zoom_from
        if delta > 0:
            zexpr = f"min({zoom_to:.4f},{zoom_from:.4f}+{delta:.4f}*on/{frames})"
        else:
            zexpr = f"max({zoom_to:.4f},{zoom_from:.4f}-{abs(delta):.4f}*on/{frames})"
    else:
        zexpr = f"{zoom_from:.4f}"

    focus = slot.get("focus") or {}
    focus_x = _clamp(float(focus.get("x") or 0.0), -1.0, 1.0)
    focus_y = _clamp(float(focus.get("y") or 0.0), -1.0, 1.0)
    base_x = "iw/2-(iw/zoom/2)"
    base_y = "ih/2-(ih/zoom/2)"
    if abs(focus_x) > 0.02:
        base_x = f"{base_x}+{focus_x * 0.5:.4f}*(iw-iw/zoom)"
    if abs(focus_y) > 0.02:
        base_y = f"{base_y}+{focus_y * 0.5:.4f}*(ih-ih/zoom)"
    if abs(pan_x) > 0.001:
        amplitude = _clamp(abs(pan_x) * 8.0, 0.0, 0.45)
        direction = 1 if pan_x > 0 else -1
        base_x = f"{base_x}+{direction}*{amplitude:.4f}*(iw-iw/zoom)*on/{frames}"
    if abs(pan_y) > 0.001:
        amplitude_y = _clamp(abs(pan_y) * 8.0, 0.0, 0.45)
        direction_y = 1 if pan_y > 0 else -1
        base_y = f"{base_y}+{direction_y}*{amplitude_y:.4f}*(ih-ih/zoom)*on/{frames}"
    if motion == "shake":
        base_x = f"{base_x}+2*sin(on/1.7)"
        base_y = f"{base_y}+2*cos(on/2.3)"

    return (
        f"zoompan=z='{zexpr}':x='{base_x}':y='{base_y}':d=1:s={width}x{height}:fps={fps}"
    )


def _grade_chain(slot: Dict[str, Any]) -> str:
    grade = slot.get("grade") or {}
    contrast = _clamp(float(grade.get("contrast", 1.0)), 0.4, 2.0)
    saturation = _clamp(float(grade.get("saturation", 1.0)), 0.0, 2.0)
    brightness = _clamp(float(grade.get("brightness", 0.0)) * 0.5, -0.4, 0.4)
    temperature = _clamp(float(grade.get("temperature", 0.0)), -0.5, 0.5)
    vignette = _clamp(float(grade.get("vignette", 0.0)), 0.0, 1.0)
    parts = [f"eq=contrast={contrast:.3f}:brightness={brightness:.3f}:saturation={saturation:.3f}"]
    if abs(temperature) > 0.02:
        parts.append(f"colorbalance=rs={temperature * 0.12:.3f}:bs={-temperature * 0.12:.3f}")
    if vignette > 0.02:
        parts.append(f"vignette=angle='{_clamp(0.18 + vignette * 0.85, 0.05, math.pi / 2):.3f}'")
    return ",".join(parts)


def _transition_chain(slot: Dict[str, Any]) -> str:
    duration = float(slot["duration"])
    transition = slot.get("transition", "cut")
    if transition == "fade":
        return f",fade=t=in:st=0:d={min(0.16, duration / 3):.3f}"
    if transition == "flash":
        return f",fade=t=in:st=0:d={min(0.07, duration / 5):.3f}:color=white"
    if transition == "whip":
        return f",fade=t=in:st=0:d={min(0.05, duration / 6):.3f}:color=black"
    return ""


@dataclass
class RenderInputs:
    clips: List[MediaInfo]
    bg_audio: Optional[str]
    sfx_audio: Optional[str]
    voice_audio: Optional[str] = None
    speech: Optional[Dict[str, List[Window]]] = None


def build_filtergraph(
    plan: Dict[str, Any],
    inputs: RenderInputs,
    width: int,
    height: int,
    fps: int,
) -> Tuple[str, float]:
    slots = [slot for slot in plan["slots"] if float(slot.get("duration", 0)) > 0.02]
    if not slots:
        raise ValueError("Render plan has no usable slots")
    if not inputs.clips:
        raise ValueError("No decodable source clips were provided")

    total = float(plan["target_duration_sec"])
    lines: List[str] = []

    for index, slot in enumerate(slots):
        path_index = index % len(inputs.clips)
        clip = inputs.clips[path_index]
        _, offset = _pick_segment(
            clip,
            float(slot["duration"]),
            index,
            int(slot.get("src_shot", 0)),
            (inputs.speech or {}).get(clip.path),
        )
        end = offset + float(slot["duration"])
        chain = (
            f"[{path_index}:v]"
            f"trim=start={offset:.4f}:end={end:.4f},setpts=PTS-STARTPTS,"
            f"fps={fps},format=yuv420p,"
            f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=fast_bilinear,"
            f"crop={width}:{height},setsar=1,"
            f"{_zoompan(slot, width, height, fps)},"
            f"{_grade_chain(slot)}"
            f"{_transition_chain(slot)},"
            f"format=yuv420p[v{index}]"
        )
        lines.append(chain)

    concat_inputs = "".join(f"[v{index}]" for index in range(len(slots)))
    lines.append(f"{concat_inputs}concat=n={len(slots)}:v=1:a=0[vcat]")
    lines.append(f"[vcat]{watermark_filter(width)},format=yuv420p[vout]")

    # ---- audio graph -----------------------------------------------------
    audio_labels: List[str] = []
    next_input = len(inputs.clips)
    for name, path, gain in (
        ("bgm", inputs.bg_audio, 0.9),
        ("sfx", inputs.sfx_audio, 0.55),
        ("voice", inputs.voice_audio, 1.0),
    ):
        if not path:
            continue
        lines.append(
            f"[{next_input}:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,"
            f"aresample=48000,volume={gain},"
            f"afade=t=in:st=0:d={min(0.15, total / 8):.3f},"
            f"afade=t=out:st={max(0.0, total - min(0.8, total / 4)):.3f}:d={min(0.8, total / 4):.3f}"
            f"[a_{name}]"
        )
        audio_labels.append(f"[a_{name}]")
        next_input += 1

    # Voiceover present → duck the BGM underneath it (sidechain compression).
    if inputs.bg_audio and inputs.voice_audio:
        # The BGM is compressed by the voiceover, then both layers are mixed.
        lines.append(
            "[a_bgm][a_voice]sidechaincompress=threshold=0.045:ratio=8:attack=8:release=220:makeup=1[a_bgm_duck]"
        )
        audio_labels = ["[a_bgm_duck]"] + [label for label in audio_labels if label != "[a_bgm]"]

    if not audio_labels:
        lines.append(f"anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:{total:.3f}[amixed]")
    elif len(audio_labels) == 1:
        lines.append(f"{audio_labels[0]}anull[a_norm_pre]")
        lines.append("[a_norm_pre]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,apad[aout]")
        return ";\n".join(lines), total
    else:
        lines.append(f"{''.join(audio_labels)}amix=inputs={len(audio_labels)}:duration=first:normalize=0[amixed]")

    lines.append("[amixed]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,apad[aout]")
    # Filtergraph chains are ';' separated — newlines are only whitespace.
    return ";\n".join(lines), total


def render_plan(
    job: Job,
    plan: Dict[str, Any],
    clip_paths: Sequence[str],
    *,
    bg_audio: Optional[str] = None,
    sfx_audio: Optional[str] = None,
    voice_audio: Optional[str] = None,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    require_ffmpeg()
    options = options or {}
    quality = str(options.get("quality") or "standard")

    trim_silence = bool(options.get("trim_silence", True))
    job.begin(
        "prepare",
        "Probing raw clips + scanning for dead air" if trim_silence else "Probing raw clips (dead-air trim disabled)",
    )
    clips: List[MediaInfo] = []
    speech: Dict[str, List[Window]] = {}
    trimmed = 0
    for path in clip_paths:
        try:
            info = probe(path)
        except Exception as exc:  # noqa: BLE001
            job.log(f"Skipping unreadable clip {Path(path).name}: {exc}")
            continue
        if info.has_video and info.duration > 0.05:
            clips.append(info)
            windows = speech_windows(path, info) if trim_silence else []
            speech[path] = windows
            if trim_silence and info.has_audio and len(windows) > 1:
                trimmed += 1
                job.log(
                    f"VAD · {Path(path).name}: {len(windows)} speech windows "
                    f"(removed {max(0.0, info.duration - sum(w[1] - w[0] for w in windows)):.1f}s of dead air from the pool)"
                )
    if not clips:
        raise ValueError("None of the supplied clips contained a decodable video stream")
    aspect = str(plan.get("aspect") or "9:16")
    width, height = output_size(aspect)
    fps = RENDER_FPS
    total = float(plan["target_duration_sec"])
    job.complete_step(
        "prepare",
        f"{len(clips)} clip(s) · {width}×{height} @ {fps}fps · {total:.2f}s target"
        + (f" · VAD on {trimmed} clip(s)" if trimmed else ""),
    )

    job.begin("graph", "Compiling deterministic filtergraph")
    inputs = RenderInputs(
        clips=clips,
        bg_audio=bg_audio if bg_audio and os.path.exists(bg_audio) else None,
        sfx_audio=sfx_audio if sfx_audio and os.path.exists(sfx_audio) else None,
        voice_audio=voice_audio if voice_audio and os.path.exists(voice_audio) else None,
        speech=speech,
    )
    graph, _ = build_filtergraph(plan, inputs, width, height, fps)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    token = secrets.token_hex(6)
    graph_path = RENDER_DIR / f"graph-{token}.txt"
    graph_path.write_text(graph, encoding="utf-8")
    output_path = RENDER_DIR / f"nexus-{token}.mp4"
    poster_path = RENDER_DIR / f"nexus-{token}.jpg"
    job.complete_step(
        "graph",
        f"{len(plan['slots'])} slots · watermark drawtext top-left · audio={'BGM' if inputs.bg_audio else 'silent'}"
        + ("+SFX" if inputs.sfx_audio else ""),
    )

    job.begin("render", "Encoding with hardware acceleration" if hardware_accel() else "Encoding with libx264")
    command: List[str] = []
    for clip in clips:
        command += ["-stream_loop", "-1", "-i", clip.path]
    if inputs.bg_audio:
        command += ["-stream_loop", "-1", "-i", inputs.bg_audio]
    if inputs.sfx_audio:
        command += ["-stream_loop", "-1", "-i", inputs.sfx_audio]
    if inputs.voice_audio:
        command += ["-stream_loop", "-1", "-i", inputs.voice_audio]
    script_flag = filter_script_flag()
    if script_flag:
        command += [script_flag, str(graph_path)]
    else:
        command += ["-filter_complex", graph]
    command += [
        "-map", "[vout]",
        "-map", "[aout]",
        "-t", f"{total:.3f}",
        "-r", str(fps),
        *video_encoder_args(quality),
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "48000",
        "-movflags", "+faststart",
        "-max_muxing_queue_size", "4096",
        "-y",
        str(output_path),
    ]

    last_bucket = -1

    def on_progress(value: float, detail: str) -> None:
        nonlocal last_bucket
        job.step_progress("render", value * 0.94, detail)
        bucket = int(value * 10)
        if bucket != last_bucket:
            last_bucket = bucket
            job.log(detail)

    try:
        run_ffmpeg(command, total_duration=total, on_progress=on_progress, timeout=max(600, int(total * 30)), label="render")
    except FFmpegError as exc:
        job.log(exc.stderr[-1200:] if exc.stderr else str(exc))
        raise
    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("FFmpeg finished without producing an output file")
    job.complete_step("render", f"{output_path.stat().st_size / (1024 * 1024):.1f} MB encoded")

    job.begin("finalize", "Extracting poster and verifying container")
    extract_frame(str(output_path), min(1.0, total / 3), str(poster_path), width=min(width, 1080))
    info = probe(str(output_path))
    job.complete_step("finalize", f"verified {info.width}×{info.height} · {info.duration:.2f}s")

    graph_path.unlink(missing_ok=True)
    return {
        "video_url": _media_url(output_path),
        "poster_url": _media_url(poster_path) if poster_path.exists() else None,
        "duration_sec": round(info.duration or total, 3),
        "width": info.width or width,
        "height": info.height or height,
        "bytes": output_path.stat().st_size,
        "engine": "ffmpeg",
        "hardware_accel": hardware_accel(),
        "plan": plan,
    }


__all__ = ["render_plan", "build_filtergraph", "output_size"]
