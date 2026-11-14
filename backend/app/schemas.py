"""Pydantic contracts shared with the Next.js studio.

The Framework DNA schema is deliberately permissive on shot-level details (the
studio may add analysis hints) but strict on the fields the scaler and renderer
actually depend on.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Grade(BaseModel):
    model_config = ConfigDict(extra="allow")
    brightness: float = 0.0
    contrast: float = 1.0
    saturation: float = 1.0
    vignette: float = 0.0
    temperature: float = 0.0


class WatermarkSpec(BaseModel):
    model_config = ConfigDict(extra="allow")
    text: str = "NEXUS FRAME"
    position: str = "top-left"
    x: int = 24
    y: int = 24
    color: str = "#E6EDF3"
    opacity: float = 0.72

    @field_validator("position")
    @classmethod
    def _force_top_left(cls, value: str) -> str:
        # The brand mark is contractually locked to the top-left corner.
        return "top-left"


class Shot(BaseModel):
    model_config = ConfigDict(extra="allow")
    index: int = 0
    start: float = 0.0
    end: float = 0.0
    duration: float = 0.0
    motion: str = "static"
    transition: str = "cut"
    pillar: int = 1
    grade: Grade = Field(default_factory=Grade)
    palette: List[str] = Field(default_factory=list)


class AudioStems(BaseModel):
    model_config = ConfigDict(extra="allow")
    vocals: Optional[str] = None
    bgm: Optional[str] = None
    sfx: Optional[str] = None


class AudioDna(BaseModel):
    model_config = ConfigDict(extra="allow")
    bpm: float = 0.0
    beat_timestamps: List[float] = Field(default_factory=list)
    downbeats: List[float] = Field(default_factory=list)
    lufs: float = -14.0
    stems: AudioStems = Field(default_factory=AudioStems)
    preview_only: bool = True


class Rhythm(BaseModel):
    model_config = ConfigDict(extra="allow")
    avg_shot_sec: float = 0.8
    cut_density: float = 1.0
    phase_ratios: Dict[str, float] = Field(
        default_factory=lambda: {"hook": 0.12, "pain": 0.2, "trigger": 0.45, "comment": 0.13, "outro": 0.1}
    )


class FrameworkDna(BaseModel):
    model_config = ConfigDict(extra="allow")
    schema_version: str = "1.0"
    id: str
    framework_name: str
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    created_at: str = ""
    origin: str = "server"
    source: Dict[str, Any] = Field(default_factory=dict)
    duration_sec: float = 0.0
    audio: AudioDna = Field(default_factory=AudioDna)
    shots: List[Shot] = Field(default_factory=list)
    pillars: List[Dict[str, Any]] = Field(default_factory=list)
    rhythm: Rhythm = Field(default_factory=Rhythm)
    grade: Grade = Field(default_factory=Grade)
    sfx_events: List[Dict[str, Any]] = Field(default_factory=list)
    watermark: WatermarkSpec = Field(default_factory=WatermarkSpec)
    stats: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("shots")
    @classmethod
    def _require_shots(cls, value: List[Shot]) -> List[Shot]:
        if not value:
            raise ValueError("A framework needs at least one shot")
        return value[:2000]

    @field_validator("framework_name")
    @classmethod
    def _require_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("framework_name is required")
        return cleaned[:120]


class RenderSlot(BaseModel):
    model_config = ConfigDict(extra="allow")
    index: int
    pillar: int = 1
    start: float
    end: float
    duration: float
    src_shot: int = 0
    motion: str = "static"
    zoom_from: float = 1.0
    zoom_to: float = 1.0
    pan: Dict[str, float] = Field(default_factory=lambda: {"x": 0.0, "y": 0.0})
    grade: Grade = Field(default_factory=Grade)
    transition: str = "cut"
    focus: Dict[str, float] = Field(default_factory=lambda: {"x": 0.0, "y": 0.0})
    overlays: List[Dict[str, Any]] = Field(default_factory=list)
    sfx: List[Dict[str, Any]] = Field(default_factory=list)


class RenderPlan(BaseModel):
    model_config = ConfigDict(extra="allow")
    framework_id: str = ""
    framework_name: str = "Untitled"
    target_duration_sec: float
    bpm: float = 0.0
    beat_grid: List[float] = Field(default_factory=list)
    crossfade_points: List[float] = Field(default_factory=list)
    slots: List[RenderSlot]
    pillars: List[Dict[str, Any]] = Field(default_factory=list)
    stats: Dict[str, Any] = Field(default_factory=dict)
    audio: Dict[str, Any] = Field(default_factory=dict)
    watermark: WatermarkSpec = Field(default_factory=WatermarkSpec)
    aspect: str = "9:16"

    @field_validator("slots")
    @classmethod
    def _limit_slots(cls, value: List[RenderSlot]) -> List[RenderSlot]:
        if not value:
            raise ValueError("Plan contains no slots")
        if len(value) > 900:
            raise ValueError("Plan exceeds the 900 slot safety limit")
        return value


class ProduceOptions(BaseModel):
    model_config = ConfigDict(extra="allow")
    target_duration_sec: float = 30.0
    bg_mode: str = "framework"
    preserve_sfx: bool = True
    aspect: Optional[str] = None
    quality: str = "standard"
