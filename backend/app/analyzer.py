"""Framework deconstruction engine.

Pipeline
--------
1. probe           → container/stream facts via ffprobe (ffmpeg fallback)
2. scene           → PySceneDetect AdaptiveDetector (ffmpeg ``scdet`` fallback,
                     histogram-difference fallback if neither is available)
3. visuals         → OpenCV Farneback optical flow, Laplacian sharpness, HSV/grade
                     estimation and per-cut motion classification
4. audio           → 22.05 kHz mono extraction, tempo/beat tracking, onset list,
                     EBU R128 loudness measurement
5. stems           → Demucs htdemucs (optional): vocals / harmonic bed / transient SFX
6. build           → serialise everything into a portable Framework DNA document

Every step is optional: the node degrades gracefully and reports which engines
were actually used, instead of pretending to do work it cannot.
"""

from __future__ import annotations

import json
import logging
import math
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from . import __version__
from .capabilities import ffmpeg_binary, ffprobe_binary
from . import vision
from .config import STEM_DIR
from .ffmpeg import MediaInfo, extract_frame, probe, require_ffmpeg, run_ffmpeg
from .jobs import Job
from .scaler import allocate_slots, round_half_up

logger = logging.getLogger("nexus.analyzer")

DEFAULT_PHASE_RATIOS = {"hook": 0.12, "pain": 0.20, "trigger": 0.45, "comment": 0.13, "outro": 0.10}
PILLAR_KEYS = ("hook", "pain", "trigger", "comment", "outro")

PILLAR_NAMES = {
    1: "Viral Hook",
    2: "Real Pain Point",
    3: "Interest & Sales Trigger",
    4: "Intent to Comment",
    5: "Motion Graphic Cues",
}
SAMPLE_W, SAMPLE_H = 160, 90


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _has_module(name: str) -> bool:
    import importlib.util

    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def _relative_media_url(path: Path) -> str:
    """Media URLs are served from /api/files/<path relative to the data dir>."""
    from .config import DATA_DIR

    try:
        relative = path.resolve().relative_to(DATA_DIR.resolve())
    except ValueError:
        relative = Path(path.name)
    return f"/api/files/{relative.as_posix()}"


def _mmss(seconds: float) -> str:
    minutes, sec = divmod(max(0.0, seconds), 60)
    return f"{int(minutes):02d}:{sec:05.2f}"


# --------------------------------------------------------------------------- #
# frame sampling
# --------------------------------------------------------------------------- #
def sample_frames(path: str, duration: float, fps: Optional[float] = None) -> Tuple[np.ndarray, float]:
    """Decode small RGB frames through ffmpeg's rawvideo pipe (memory safe)."""
    binary = require_ffmpeg()
    if not duration or duration <= 0:
        return np.zeros((0, SAMPLE_H, SAMPLE_W, 3), dtype=np.uint8), 0.0
    rate = fps or _clamp(round(900 / max(1.0, duration)), 2, 8)
    command = [
        binary,
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        path,
        "-an",
        "-vf",
        f"fps={rate:.3f},scale={SAMPLE_W}:{SAMPLE_H}:flags=fast_bilinear",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
    ]
    result = subprocess.run(command, capture_output=True, timeout=max(120, int(duration * 4)))
    buffer = np.frombuffer(result.stdout, dtype=np.uint8)
    frame_size = SAMPLE_W * SAMPLE_H * 3
    count = len(buffer) // frame_size
    if count == 0:
        return np.zeros((0, SAMPLE_H, SAMPLE_W, 3), dtype=np.uint8), rate
    frames = buffer[: count * frame_size].reshape((count, SAMPLE_H, SAMPLE_W, 3))
    return frames, rate


def _to_gray(frames: np.ndarray) -> np.ndarray:
    if frames.size == 0:
        return np.zeros((0, SAMPLE_H, SAMPLE_W), dtype=np.float32)
    weights = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return (frames.astype(np.float32) @ weights) / 255.0


def _histograms(frames: np.ndarray) -> np.ndarray:
    if frames.size == 0:
        return np.zeros((0, 16), dtype=np.float32)
    gray = (_to_gray(frames) * 16).astype(np.int32)
    gray = np.clip(gray, 0, 15)
    histograms = np.zeros((frames.shape[0], 16), dtype=np.float32)
    for index in range(frames.shape[0]):
        counts = np.bincount(gray[index].reshape(-1), minlength=16).astype(np.float32)
        histograms[index] = counts / counts.sum()
    return histograms


def _frame_stats(frames: np.ndarray) -> List[Dict[str, float]]:
    gray = _to_gray(frames)
    stats: List[Dict[str, float]] = []
    for index in range(frames.shape[0]):
        frame = frames[index].astype(np.float32)
        luma = gray[index]
        rgb = frame.reshape(-1, 3)
        mean = float(luma.mean())
        variance = float(np.var(luma))
        max_channel = rgb.max(axis=1)
        min_channel = rgb.min(axis=1)
        saturation = np.divide(
            max_channel - min_channel,
            np.maximum(max_channel, 1.0),
        )
        laplacian = (
            4 * luma[1:-1, 1:-1]
            - luma[1:-1, :-2]
            - luma[1:-1, 2:]
            - luma[:-2, 1:-1]
            - luma[2:, 1:-1]
        )
        stats.append(
            {
                "luma": mean,
                "contrast": math.sqrt(max(0.0, variance)),
                "saturation": float(saturation.mean()),
                "sharpness": _clamp(float(laplacian.var()) * 900.0, 0.0, 1.0),
                "warmth": float((rgb[:, 0].mean() - rgb[:, 2].mean()) / 255.0),
                "rgb": [float(rgb[:, 0].mean()), float(rgb[:, 1].mean()), float(rgb[:, 2].mean())],
            }
        )
    return stats


_FACE_CASCADE = None


def _face_cascade():
    """Lazy Haar cascade (ships with OpenCV) for active-speaker reframing."""
    global _FACE_CASCADE
    if _FACE_CASCADE is not None:
        return _FACE_CASCADE
    try:
        import cv2

        path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
        if path.exists():
            cascade = cv2.CascadeClassifier(str(path))
            if not cascade.empty():
                _FACE_CASCADE = cascade
                return cascade
    except Exception:  # noqa: BLE001 - face tracking is best-effort
        pass
    _FACE_CASCADE = False
    return None


def face_focus(frames: np.ndarray, start: float, end: float, sample_fps: float) -> Dict[str, Any]:
    """Normalised face centre for a shot (fraction of half-frame, -1..1)."""
    cascade = _face_cascade()
    if cascade is None or frames.shape[0] == 0:
        return {"x": 0.0, "y": 0.0, "detected": False}
    first = max(0, int(start * sample_fps))
    last = min(frames.shape[0], max(first + 1, int(end * sample_fps)))
    xs: List[float] = []
    ys: List[float] = []
    try:
        import cv2

        for index in range(first, last, max(1, (last - first) // 4 or 1)):
            gray = cv2.cvtColor(frames[index], cv2.COLOR_RGB2GRAY)
            faces = cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=4, minSize=(18, 18))
            if len(faces) == 0:
                continue
            x, y, width, height = max(faces, key=lambda box: box[2] * box[3])
            xs.append(((x + width / 2) / SAMPLE_W - 0.5) * 2)
            ys.append(((y + height / 2) / SAMPLE_H - 0.5) * 2)
    except Exception:  # noqa: BLE001
        return {"x": 0.0, "y": 0.0, "detected": False}
    if not xs:
        return {"x": 0.0, "y": 0.0, "detected": False}
    return {
        "x": round_half_up(_clamp(float(np.median(xs)), -1.0, 1.0), 3),
        "y": round_half_up(_clamp(float(np.median(ys)), -1.0, 1.0), 3),
        "detected": True,
    }


def _optical_flow(prev_gray: np.ndarray, gray: np.ndarray) -> Dict[str, float]:
    """Farneback flow with radial divergence (zoom) and lateral split (pan)."""
    try:
        import cv2
    except ImportError:
        diff = np.abs(gray - prev_gray)
        return {
            "motion": _clamp(float(diff.mean()) * 12, 0, 1),
            "center": _clamp(float(diff[20:70, 40:120].mean()) * 12, 0, 1),
            "border": _clamp(float(diff.mean()) * 12, 0, 1),
            "divergence": 0.0,
            "pan": 0.0,
        }

    prev_u8 = (prev_gray * 255).astype(np.uint8)
    gray_u8 = (gray * 255).astype(np.uint8)
    flow = cv2.calcOpticalFlowFarneback(prev_u8, gray_u8, None, 0.5, 3, 15, 3, 5, 1.2, 0)
    magnitude = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
    height, width = gray.shape
    yy, xx = np.mgrid[0:height, 0:width]
    radial_x = xx - width / 2.0
    radial_y = yy - height / 2.0
    norm = np.maximum(np.sqrt(radial_x**2 + radial_y**2), 1.0)
    radial_flow = (flow[..., 0] * radial_x + flow[..., 1] * radial_y) / norm
    center_mask = (slice(int(height * 0.3), int(height * 0.7)), slice(int(width * 0.3), int(width * 0.7)))
    center_mag = float(magnitude[center_mask].mean())
    border_mask = np.ones_like(magnitude, dtype=bool)
    border_mask[center_mask] = False
    border_mag = float(magnitude[border_mask].mean())
    return {
        "motion": _clamp(float(magnitude.mean()) / 2.4, 0, 1),
        "center": _clamp(center_mag / 2.4, 0, 1),
        "border": _clamp(border_mag / 2.4, 0, 1),
        "divergence": float(radial_flow.mean()),
        "pan": float(flow[..., 0].mean()),
    }


def classify_motion(samples: Sequence[Dict[str, float]]) -> Tuple[str, float]:
    if not samples:
        return "static", 0.0
    motion = sum(item["motion"] for item in samples) / len(samples)
    divergence = sum(item.get("divergence", 0.0) for item in samples) / len(samples)
    pan = sum(item.get("pan", 0.0) for item in samples) / len(samples)
    center = sum(item.get("center", 0.0) for item in samples) / len(samples)
    border = sum(item.get("border", 0.0) for item in samples) / len(samples)
    if motion < 0.05:
        return "static", motion
    if divergence > 0.35 and center > border * 0.9:
        return "zoom_in", motion
    if divergence < -0.35:
        return "zoom_out", motion
    if abs(pan) > 0.22:
        return "pan_right" if pan > 0 else "pan_left", motion
    if motion > 0.55:
        return "shake", motion
    return "handheld", motion


# --------------------------------------------------------------------------- #
# scene detection
# --------------------------------------------------------------------------- #
def _scenes_with_pyscenedetect(path: str) -> Optional[Tuple[List[float], str]]:
    if not _has_module("scenedetect"):
        return None
    try:
        from scenedetect import AdaptiveDetector, detect  # type: ignore

        scenes = detect(path, AdaptiveDetector(adaptive_threshold=3.0, min_scene_len=8))
        boundaries = [0.0]
        for scene in scenes:
            start = scene[0].get_seconds() if hasattr(scene[0], "get_seconds") else float(scene[0])
            if 0.08 < start:
                boundaries.append(start)
        boundaries = sorted({round(value, 3) for value in boundaries})
        return boundaries, "PySceneDetect/AdaptiveDetector"
    except Exception as exc:  # noqa: BLE001 - any detector failure falls back
        logger.warning("PySceneDetect failed: %s", exc)
        return None


def _scenes_with_ffmpeg(path: str, duration: float) -> Optional[Tuple[List[float], str]]:
    binary = ffmpeg_binary()
    if not binary or duration <= 0:
        return None
    try:
        result = subprocess.run(
            [
                binary,
                "-hide_banner",
                "-nostdin",
                "-loglevel",
                "info",
                "-i",
                path,
                "-an",
                "-vf",
                "scdet=threshold=8,metadata=mode=print",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
            timeout=max(120, int(duration * 6)),
        )
        times = [float(match) for match in re.findall(r"lavfi\.scd\.time=([0-9.]+)", result.stderr)]
        times = [value for value in times if 0.08 < value < duration - 0.05]
        if not times:
            return None
        boundaries = sorted({0.0, *[round(value, 3) for value in times]})
        return boundaries, "ffmpeg/scdet"
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("ffmpeg scdet failed: %s", exc)
        return None


def _scenes_with_histograms(frames: np.ndarray, duration: float) -> Tuple[List[float], str]:
    if frames.shape[0] < 3:
        return [0.0], "histogram/insufficient-frames"
    histograms = _histograms(frames)
    diffs = np.abs(np.diff(histograms, axis=0)).sum(axis=1) / 2.0
    mean, std = float(diffs.mean()), float(diffs.std())
    threshold = max(0.24, mean + std * 1.9)
    sample_interval = duration / frames.shape[0]
    boundaries = [0.0]
    last = 0.0
    for index, value in enumerate(diffs, start=1):
        if value <= threshold:
            continue
        moment = index * sample_interval
        if moment - last >= 0.18:
            boundaries.append(round(moment, 3))
            last = moment
    return boundaries, "histogram-difference"


def _boundaries_to_shots(boundaries: Sequence[float], duration: float) -> List[Tuple[float, float]]:
    points = sorted({0.0, *[max(0.0, min(duration, value)) for value in boundaries], duration})
    shots: List[Tuple[float, float]] = []
    for start, end in zip(points, points[1:]):
        if end - start >= 0.12:
            shots.append((start, end))
    if not shots:
        shots = [(0.0, max(0.2, duration))]
    return shots


def detect_scenes(path: str, duration: float, frames: np.ndarray) -> Tuple[List[Tuple[float, float]], str]:
    detected = _scenes_with_pyscenedetect(path) or _scenes_with_ffmpeg(path, duration)
    if detected:
        boundaries, method = detected
    else:
        boundaries, method = _scenes_with_histograms(frames, duration)
    return _boundaries_to_shots(boundaries, duration), method


# --------------------------------------------------------------------------- #
# audio
# --------------------------------------------------------------------------- #
def extract_wav(video_path: str, output: Path, sample_rate: int = 22050) -> bool:
    media = probe(video_path)
    if not media.has_audio:
        return False
    run_ffmpeg(
        [
            "-i",
            video_path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-acodec",
            "pcm_s16le",
            str(output),
            "-y",
        ],
        label="extract-audio",
    )
    return output.exists() and output.stat().st_size > 44


def _loudness_lufs(wav_path: Path) -> float:
    binary = ffmpeg_binary()
    if binary:
        try:
            result = subprocess.run(
                [
                    binary,
                    "-hide_banner",
                    "-nostdin",
                    "-i",
                    str(wav_path),
                    "-af",
                    "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
                    "-f",
                    "null",
                    "-",
                ],
                capture_output=True,
                text=True,
                timeout=120,
            )
            matches = re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", result.stderr, re.S)
            if matches:
                payload = json.loads(matches[-1])
                return round(float(payload["input_i"]), 1)
        except (OSError, subprocess.SubprocessError, ValueError, KeyError):
            pass
    return -14.0


def _numpy_audio_fingerprint(samples: np.ndarray, sample_rate: int) -> Dict[str, Any]:
    """Spectral-flux onset envelope + autocorrelation tempo, no librosa needed."""
    frame_size, hop = 1024, 128
    if samples.size < frame_size:
        return {"bpm": 120.0, "beats": [], "onsets": [], "envelope": []}
    window = np.hanning(frame_size).astype(np.float32)
    count = (len(samples) - frame_size) // hop
    envelope = np.zeros(count, dtype=np.float32)
    previous = np.zeros(frame_size // 2 + 1, dtype=np.float32)
    for index in range(count):
        chunk = samples[index * hop : index * hop + frame_size] * window
        spectrum = np.abs(np.fft.rfft(chunk))
        flux = np.maximum(0.0, spectrum - previous).sum()
        envelope[index] = flux
        previous = spectrum
    if envelope.max() > 0:
        local = np.convolve(envelope, np.ones(25) / 25, mode="same")
        envelope = np.maximum(0.0, envelope - local)
        peak = envelope.max()
        if peak > 0:
            envelope /= peak
    fps = sample_rate / hop
    min_lag, max_lag = int(60 / 200 * fps), int(60 / 60 * fps)
    best_lag, best_score = min_lag, -1.0
    for lag in range(min_lag, min(max_lag, len(envelope) - 1) + 1):
        score = float(np.dot(envelope[:-lag], envelope[lag:]) / max(1, len(envelope) - lag))
        if score > best_score:
            best_score, best_lag = score, lag
    bpm = _clamp(60 * fps / best_lag, 50, 200)
    period = 60.0 / bpm
    onsets = [
        round(index / fps, 3)
        for index in range(1, len(envelope) - 1)
        if envelope[index] > 0.18 and envelope[index] >= envelope[index - 1] and envelope[index] >= envelope[index + 1]
    ]
    beats: List[float] = []
    moment = 0.0
    while moment < len(samples) / sample_rate:
        beats.append(round(moment, 3))
        moment += period
    buckets = 600
    step = max(1, len(samples) // buckets)
    envelope_compact = [
        round(float(np.abs(samples[i * step : (i + 1) * step]).max(initial=0.0)), 4) for i in range(min(buckets, len(samples) // step))
    ]
    peak_value = max(envelope_compact) if envelope_compact else 1.0
    envelope_compact = [round(value / (peak_value or 1.0), 3) for value in envelope_compact]
    return {"bpm": round(bpm, 1), "beats": beats, "onsets": onsets, "envelope": envelope_compact}


def analyze_audio(wav_path: Path) -> Dict[str, Any]:
    meta: Dict[str, Any] = {
        "bpm": 120.0,
        "beats": [],
        "downbeats": [],
        "onsets": [],
        "lufs": _loudness_lufs(wav_path),
        "method": "none",
        "envelope": [],
    }
    if not wav_path.exists():
        return meta

    if _has_module("librosa"):
        try:
            import librosa  # type: ignore

            samples, sample_rate = librosa.load(str(wav_path), sr=22050, mono=True)
            tempo, beat_frames = librosa.beat.beat_track(y=samples, sr=sample_rate, units="frames")
            bpm = float(np.atleast_1d(tempo)[0])
            beats = [round(float(value), 3) for value in librosa.frames_to_time(beat_frames, sr=sample_rate)]
            onsets = [
                round(float(value), 3)
                for value in librosa.onset.onset_detect(y=samples, sr=sample_rate, units="time", backtrack=False)
            ]
            meta.update({"bpm": round(bpm, 1), "beats": beats, "downbeats": beats[::4], "onsets": onsets, "method": "librosa"})
            return meta
        except Exception as exc:  # noqa: BLE001 - fall back to numpy DSP
            logger.warning("librosa analysis failed (%s); using numpy DSP", exc)

    try:
        import wave

        with wave.open(str(wav_path), "rb") as handle:
            sample_rate = handle.getframerate()
            frames = handle.readframes(handle.getnframes())
            samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        fingerprint = _numpy_audio_fingerprint(samples, sample_rate)
        meta.update(
            {
                "bpm": fingerprint["bpm"],
                "beats": fingerprint["beats"],
                "downbeats": fingerprint["beats"][::4],
                "onsets": fingerprint["onsets"],
                "envelope": fingerprint["envelope"],
                "method": "numpy-spectral-flux",
            }
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("numpy audio analysis failed: %s", exc)
    return meta


# --------------------------------------------------------------------------- #
# stems
# --------------------------------------------------------------------------- #
def isolate_stems(job: Job, wav_path: Path, workdir: Path, prefix: str) -> Optional[Dict[str, Any]]:
    """Demucs htdemucs → vocals / harmonic bed (BGM) / transient SFX."""
    if not _has_module("demucs") or not wav_path.exists():
        return None
    job.log("Running Demucs htdemucs 4-stem separation (this is the slow step)…")
    output = workdir / "demucs"
    try:
        result = subprocess.run(
            [sys.executable, "-m", "demucs", "-n", "htdemucs", "-o", str(output), str(wav_path)],
            capture_output=True,
            text=True,
            timeout=1800,
        )
        if result.returncode != 0:
            job.log(f"Demucs failed: {result.stderr[-300:]}")
            return None
    except (OSError, subprocess.SubprocessError) as exc:
        job.log(f"Demucs unavailable: {exc}")
        return None

    stem_dir = output / "htdemucs" / wav_path.stem
    vocals = stem_dir / "vocals.wav"
    drums = stem_dir / "drums.wav"
    bass = stem_dir / "bass.wav"
    other = stem_dir / "other.wav"
    if not vocals.exists():
        return None

    STEM_DIR.mkdir(parents=True, exist_ok=True)
    outputs: Dict[str, Path] = {}
    try:
        vocals_target = STEM_DIR / f"{prefix}-vocals.wav"
        shutil.copyfile(vocals, vocals_target)
        outputs["vocals"] = vocals_target

        if drums.exists():
            sfx_target = STEM_DIR / f"{prefix}-sfx.wav"
            shutil.copyfile(drums, sfx_target)
            outputs["sfx"] = sfx_target

        if bass.exists() and other.exists():
            bgm_target = STEM_DIR / f"{prefix}-bgm.wav"
            run_ffmpeg(
                [
                    "-i", str(bass),
                    "-i", str(other),
                    "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]",
                    "-map", "[a]", "-ac", "2", "-ar", "48000",
                    str(bgm_target), "-y",
                ],
                label="bgm-stem",
            )
            outputs["bgm"] = bgm_target
        else:
            bed_target = STEM_DIR / f"{prefix}-bgm.wav"
            shutil.copyfile(wav_path, bed_target)
            outputs["bgm"] = bed_target
    except Exception as exc:  # noqa: BLE001
        job.log(f"Stem export failed: {exc}")
        return None

    return {key: _relative_media_url(value) for key, value in outputs.items()}


# --------------------------------------------------------------------------- #
# DNA assembly
# --------------------------------------------------------------------------- #
def assign_pillars(shots: List[Dict[str, Any]], ratios: Dict[str, float]) -> None:
    """Map shots onto the five retention pillars as contiguous, monotonic bands.

    Counts come from largest-remainder apportionment of the phase ratios, so the
    analysed DNA and every generated plan describe the same retention shape.
    Above five shots no pillar is ever empty; below five shots the allocation
    follows retention priority (hook first).
    """
    if not shots:
        return
    counts = allocate_slots([ratios[key] for key in PILLAR_KEYS], len(shots))
    cursor = 0
    for index, count in enumerate(counts):
        for shot in shots[cursor : cursor + count]:
            shot["pillar"] = index + 1
        cursor += count


def _transition_for(frames: np.ndarray, sample_fps: float, boundary: float) -> str:
    index = int(round(boundary * sample_fps))
    if index <= 0 or index >= frames.shape[0] - 1:
        return "cut"
    before = _histograms(frames[index - 1 : index])[0]
    after = _histograms(frames[index : index + 1])[0]
    distance = float(np.abs(before - after).sum() / 2.0)
    if distance < 0.34:
        return "cut"
    luma_before = float(_to_gray(frames[index - 1 : index]).mean())
    luma_after = float(_to_gray(frames[index : index + 1]).mean())
    if abs(luma_after - luma_before) > 0.2:
        return "flash"
    if distance > 0.6:
        return "glitch"
    return "whip"


def build_framework(
    *,
    source_path: Path,
    source_label: str,
    source_kind: str,
    framework_name: str,
    info: MediaInfo,
    shots: List[Tuple[float, float]],
    frames: np.ndarray,
    sample_fps: float,
    scene_method: str,
    audio: Dict[str, Any],
    stems: Optional[Dict[str, str]],
    has_audio: bool,
) -> Dict[str, Any]:
    duration = max(0.2, info.duration or (shots[-1][1] if shots else 0.2))
    frame_stats = _frame_stats(frames)
    gray = _to_gray(frames)
    ratios = dict(DEFAULT_PHASE_RATIOS)
    shot_docs: List[Dict[str, Any]] = []

    for index, (start, end) in enumerate(shots):
        first = int(round(start * sample_fps))
        last = max(first + 1, int(round(end * sample_fps)))
        window = list(range(max(0, first), min(len(frame_stats), last))) or [0]
        stats = [frame_stats[i] for i in window if i < len(frame_stats)]
        flows: List[Dict[str, float]] = []
        for i in range(max(1, window[0]), min(len(gray), window[-1] + 1)):
            if i - 1 >= 0:
                flows.append(_optical_flow(gray[i - 1], gray[i]))
        motion, energy = classify_motion(flows)
        sharpness = sum(item["sharpness"] for item in stats) / max(1, len(stats))
        luma = sum(item["luma"] for item in stats) / max(1, len(stats))
        contrast = sum(item["contrast"] for item in stats) / max(1, len(stats))
        saturation = sum(item["saturation"] for item in stats) / max(1, len(stats))
        warmth = sum(item["warmth"] for item in stats) / max(1, len(stats))
        vignette = _clamp((contrast - 0.18) * 1.6, 0.0, 0.6)
        transition = _transition_for(frames, sample_fps, start)
        effects: List[str] = []
        if energy > 0.55:
            effects.append("high_motion")
        if transition == "flash":
            effects.append("flash_frame")
        if motion == "shake":
            effects.append("impact_shake")
        if sharpness < 0.28:
            effects.append("soft_focus")
        if saturation < 0.2:
            effects.append("silver_grade")
        palette = []
        for sample in stats[:3]:
            rgb = sample.get("rgb") or [128, 128, 128]
            palette.append("#" + "".join(f"{int(_clamp(round(c), 0, 255)):02X}" for c in rgb))

        shot_docs.append(
            {
                "index": len(shot_docs),
                "start": round_half_up(start, 3),
                "end": round_half_up(end, 3),
                "duration": round_half_up(end - start, 3),
                "motion": motion,
                "motion_energy": round_half_up(_clamp(energy * 1.2, 0.0, 1.0), 2),
                "sharpness": round_half_up(sharpness, 2),
                "transition": transition,
                "effects": effects,
                "pillar": 0,
                "grade": {
                    "brightness": round_half_up(_clamp((luma - 0.46) * 1.5, -0.4, 0.4), 3),
                    "contrast": round_half_up(_clamp(0.82 + contrast * 2.2, 0.85, 1.45), 3),
                    "saturation": round_half_up(_clamp(0.6 + saturation * 1.6, 0.5, 1.5), 3),
                    "vignette": round_half_up(vignette, 3),
                    "temperature": round_half_up(_clamp(warmth * 2.2, -0.5, 0.5), 3),
                },
                "palette": palette,
                "focus": face_focus(frames, start, end, sample_fps),
            }
        )

    assign_pillars(shot_docs, ratios)

    cut_times = [shot["start"] for shot in shot_docs if shot["start"] > 0.2]
    sfx_events: List[Dict[str, Any]] = []
    for onset in audio.get("onsets", []):
        hit = next((cut for cut in cut_times if abs(cut - onset) <= 0.07), None)
        if hit is None:
            continue
        shot = next((doc for doc in shot_docs if abs(doc["start"] - hit) < 1e-6), None)
        transition = (shot or {}).get("transition", "cut")
        kind = {"whip": "whoosh", "flash": "hit", "glitch": "glitch"}.get(transition, "click")
        sfx_events.append({"t": round_half_up(onset, 3), "type": kind, "gain": -12})

    total_shot_time = sum(shot["duration"] for shot in shot_docs) or duration
    palette_counts: Dict[str, int] = {}
    for shot in shot_docs:
        for color in shot["palette"]:
            palette_counts[color] = palette_counts.get(color, 0) + 1
    top_palette = [color for color, _ in sorted(palette_counts.items(), key=lambda item: item[1], reverse=True)[:5]]
    average_grade = {
        key: round_half_up(float(np.mean([shot["grade"][key] for shot in shot_docs])), 3)
        for key in ("brightness", "contrast", "saturation", "vignette", "temperature")
    }
    beats = audio.get("beats") or []
    pillars = []
    for pillar in range(1, 6):
        in_pillar = [shot for shot in shot_docs if shot["pillar"] == pillar]
        pillars.append(
            {
                "pillar": pillar,
                "name": PILLAR_NAMES[pillar],
                "start": in_pillar[0]["start"] if in_pillar else 0.0,
                "end": in_pillar[-1]["end"] if in_pillar else 0.0,
                "shot_count": len(in_pillar),
            }
        )

    framework_id = f"fw_{uuid.uuid4().hex[:10]}"
    return {
        "schema_version": "1.0",
        "id": framework_id,
        "framework_name": framework_name.strip()[:120] or source_label,
        "description": f"Observed on the production node via {scene_method}.",
        "tags": ["observed", info.aspect, scene_method.split("/")[0].lower()],
        "created_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(timespec="seconds"),
        "origin": "server",
        "source": {
            "kind": source_kind,
            "label": source_label,
            "width": info.width,
            "height": info.height,
            "fps": info.fps or 30.0,
            "aspect": info.aspect,
        },
        "duration_sec": round_half_up(duration, 3),
        "audio": {
            "bpm": audio.get("bpm", 120.0),
            "beat_timestamps": beats,
            "downbeats": audio.get("downbeats", []),
            "lufs": audio.get("lufs", -14.0),
            "stems": {
                "vocals": (stems or {}).get("vocals"),
                "bgm": (stems or {}).get("bgm"),
                "sfx": (stems or {}).get("sfx"),
            },
            "preview_only": stems is None,
        },
        "shots": shot_docs,
        "pillars": pillars,
        "rhythm": {
            "avg_shot_sec": round_half_up(total_shot_time / max(1, len(shot_docs)), 3),
            "cut_density": round_half_up(len(shot_docs) / max(duration, 0.1), 3),
            "phase_ratios": ratios,
        },
        "grade": average_grade,
        "sfx_events": sfx_events[:60],
        "watermark": {"text": "NEXUS FRAME", "position": "top-left", "x": 24, "y": 24, "color": "#E6EDF3", "opacity": 0.72},
        "stats": {
            "cuts": len(shot_docs),
            "avg_clip_duration": round_half_up(total_shot_time / max(1, len(shot_docs)), 3),
            "zoom_ratio": round_half_up(
                sum(1 for shot in shot_docs if shot["motion"].startswith("zoom")) / max(1, len(shot_docs)), 2
            ),
            "motion_energy": round_half_up(
                sum(shot["motion_energy"] for shot in shot_docs) / max(1, len(shot_docs)), 2
            ),
        },
        "meta": {
            "engine_version": __version__,
            "scene_detection": scene_method,
            "beat_tracking": audio.get("method", "none"),
            "stems": "demucs/htdemucs" if stems else "reference-mix",
            "has_audio": has_audio,
            "palette": top_palette,
        },
    }


# --------------------------------------------------------------------------- #
# orchestration
# --------------------------------------------------------------------------- #
def analyze_reference(
    job: Job,
    source_path: str,
    *,
    framework_name: str = "",
    source_kind: str = "upload",
    source_label: Optional[str] = None,
) -> Dict[str, Any]:
    path = Path(source_path)
    label = source_label or path.name
    name = framework_name.strip() or path.stem

    job.begin("ingest", "Probing container & streams")
    info = probe(path)
    if not info.has_video or info.width == 0:
        raise ValueError("No decodable video stream found in this file.")
    job.complete_step(
        "ingest",
        f"{info.width}×{info.height} · {_mmss(info.duration)} · {info.fps or 30:.0f} fps · {info.codec or 'video'}",
    )

    sample_fps_hint = _clamp(round(900 / max(1.0, info.duration)), 2, 8)
    job.begin("scene", "Decoding low-res frames for scene analysis")
    frames, sample_fps = sample_frames(str(path), info.duration, sample_fps_hint)
    if frames.shape[0] == 0:
        raise ValueError("Frame decoding returned no frames.")
    job.step_progress("scene", 0.35, f"{frames.shape[0]} frames sampled at {sample_fps:.1f} fps")
    shots, scene_method = detect_scenes(str(path), info.duration, frames)
    job.complete_step("scene", f"{len(shots)} shots · {scene_method}")

    job.begin("audio", "Extracting 22.05 kHz mono reference")
    workdir = Path(tempfile.mkdtemp(prefix=f"nexus-{job.id}-"))
    wav_path = workdir / "reference.wav"
    try:
        has_audio = extract_wav(str(path), wav_path)
    except Exception as exc:  # noqa: BLE001
        job.log(f"Audio extraction failed: {exc}")
        has_audio = False
    audio = analyze_audio(wav_path) if has_audio else analyze_audio(Path("/nonexistent.wav"))
    if has_audio:
        job.complete_step("audio", f"{audio['bpm']} BPM · {len(audio['beats'])} beats · {audio['lufs']} LUFS · {audio['method']}")
    else:
        job.skip_step("audio", "Source has no audio track — neutral 120 BPM grid applied")

    job.begin("stems", "Isolating vocals / BGM / SFX")
    stems: Optional[Dict[str, str]] = None
    try:
        stems = isolate_stems(job, wav_path, workdir, job.id)
    except Exception as exc:  # noqa: BLE001
        job.log(f"Stem separation failed: {exc}")
    if stems:
        job.complete_step("stems", "Demucs: vocals + harmonic bed + transient SFX isolated")
    else:
        job.skip_step("stems", "Demucs not available — reference mix retained (preview_only)")

    job.begin("visuals", "Optical flow, sharpness and grade estimation")
    job.step_progress("visuals", 0.5, "Classifying motion per cut")
    architect = build_framework(
        source_path=path,
        source_label=label,
        source_kind=source_kind,
        framework_name=name,
        info=info,
        shots=shots,
        frames=frames,
        sample_fps=sample_fps,
        scene_method=scene_method,
        audio=audio,
        stems=stems,
        has_audio=has_audio,
    )
    job.complete_step("visuals", f"{len(architect['shots'])} cuts classified ({architect['stats']['zoom_ratio']:.0%} zoom)")

    # Optional qualitative pass: hosted vision model tags style + graphics.
    vision_status = vision.status()
    if vision_status["enabled"]:
        job.log(f"Vision pass · {vision_status['provider']}/{vision_status['model']}")
        keyframes = []
        for fraction in (0.08, 0.38, 0.72, 0.94):
            frame_path = workdir / f"keyframe-{int(fraction * 100)}.jpg"
            if extract_frame(str(path), info.duration * fraction, str(frame_path), width=768):
                keyframes.append(frame_path)
        notes = vision.describe_edit(keyframes)
        if notes:
            architect.setdefault("meta", {})["vision"] = notes
            extra_tags = [str(tag).lower().replace(" ", "-") for tag in notes.get("tags", [])][:4]
            architect["tags"] = list(dict.fromkeys([*architect["tags"], *extra_tags]))[:8]
            job.log(f"Vision notes: {notes.get('editing_style', 'n/a')} · {notes.get('transition_style', 'n/a')}")
        else:
            job.log("Vision pass returned nothing — continuing with numeric analysis")
    else:
        job.log("Vision pass skipped (set NEXUS_VISION_PROVIDER + NEXUS_VISION_API_KEY to enable)")

    job.begin("build", "Mapping the five retention pillars")
    job.step_progress("build", 0.6, "Serialising portable Framework DNA")
    job.complete_step(
        "build",
        f"{len(architect['shots'])} shots · {architect['rhythm']['avg_shot_sec']:.2f}s avg · {architect['audio']['bpm']} BPM",
    )

    shutil.rmtree(workdir, ignore_errors=True)
    job.log(f"Framework DNA ready: {architect['framework_name']} ({architect['id']})")
    return {"framework": architect, "stems": stems or {}, "method": {"scene": scene_method, "beats": audio.get("method")}}


__all__ = ["analyze_reference", "build_framework", "sample_frames", "detect_scenes", "analyze_audio", "isolate_stems"]
