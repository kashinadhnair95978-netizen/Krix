"""
Captions — builds .srt / .ass from timed words/segments.

One excellent default style (bottom-centered, bold white with black outline and
safe margins) is exposed as `ASS_STYLE`; everything is configurable from env.
Word/timing data comes from the ASR forced aligner. Pure functions so tests can
exercise cue-building, wrapping and styling without ffmpeg.
"""

from __future__ import annotations

from app import config as cfg


def ass_color(hex_rgb: str) -> str:
    """Convert RRGGBB or &HAABBGGRR input to ASS &HAABBGGRR format."""
    value = hex_rgb.strip().lstrip("#&").replace("H", "").upper()
    if len(value) == 6:
        r, g, b = value[0:2], value[2:4], value[4:6]
        return f"&H00{b}{g}{r}"
    if len(value) == 8:
        return f"&H{value}"
    return "&H00FFFFFF"


def ass_time(seconds: float) -> str:
    """h:mm:ss.cc ASS timestamp."""
    seconds = max(0.0, float(seconds))
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def srt_time(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    ms = int(round((seconds % 1) * 1000))
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def wrap_text(text: str, max_chars: int = 32) -> str:
    """Greedy word wrap; no hard cuts mid-word over max_chars."""
    max_chars = max(8, int(max_chars))
    words = text.split()
    if not words:
        return ""
    lines: list[str] = []
    current = ""
    for word in words:
        if len(word) > max_chars:
            word = f"{word[: max_chars - 1]}…"
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= max_chars:
            current = f"{current} {word}"
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return "\x85".join(lines)


def segments_to_cues(segments: list[dict], max_chars: int | None = None) -> list[dict]:
    """Normalize [{start,end,text}] into caption cues with wrapped text."""
    max_chars = max_chars or cfg.CAPTION_MAX_CHARS
    cues = []
    for seg in segments:
        start = float(seg.get("start", 0.0) or 0.0)
        end = float(seg.get("end", start + 1.0) or start + 1.0)
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        cues.append(
            {
                "start": start,
                "end": max(end, start + 0.3),
                "text": wrap_text(text, max_chars),
            }
        )
    cues.sort(key=lambda c: float(c.get("start", 0.0)))
    return cues


def build_ass(cues: list[dict], *, width: int = 1080, height: int = 1920) -> str:
    """ASS library file (v4.00+) for burning with ffmpeg's subtitles filter."""
    style = f"""Style: {cfg.CAPTION_STYLE_NAME},Arial,{cfg.CAPTION_FONT_SIZE},{ass_color(cfg.CAPTION_FONT_COLOR)},&H000000FF,{ass_color(cfg.CAPTION_OUTLINE_COLOR)},&H64000000,1,0,0,0,100,100,0,0,1,{cfg.CAPTION_OUTLINE_WIDTH},0,2,80,80,{cfg.CAPTION_MARGIN_BOTTOM},1"""

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        style,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for cue in sorted(cues, key=lambda c: float(c.get("start", 0.0))):
        start = ass_time(cue["start"])
        end = ass_time(cue["end"])
        text = (cue["text"] or "")
        text = text.replace("\x85", "\\N").replace("\n", "\\N").replace("{", "(").replace("}", ")")
        lines.append(f"Dialogue: 0,{start},{end},{cfg.CAPTION_STYLE_NAME},,0,0,0,,{text}")
    return "\n".join(lines) + "\n"


def build_srt(cues: list[dict]) -> str:
    lines: list[str] = []
    for i, cue in enumerate(sorted(cues, key=lambda c: float(c.get("start", 0.0))), start=1):
        lines.append(str(i))
        lines.append(f"{srt_time(cue['start'])} --> {srt_time(cue['end'])}")
        text = (cue["text"] or "").replace("\x85", "\n").replace("\n", "\n")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)