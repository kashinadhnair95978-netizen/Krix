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


def words_to_cues(
    words: list[dict],
    *,
    max_chars: int | None = None,
    max_words: int = 6,
    max_duration: float = 4.0,
    pause_break: float = 0.6,
    min_duration: float = 0.3,
) -> list[dict]:
    """Group timed words into readable short-form caption cues.

    ASR segments are far too coarse for burn-in captions: a 4.6s "segment" can
    carry an entire paragraph, which renders as an unreadable wall of text. Real
    short-form captions are built from word timings, so this groups words until
    one of these natural breaks is reached:

    * ``max_words`` words, or ``max_chars`` characters of text
    * a pause longer than ``pause_break`` seconds (a breath or sentence gap)
    * sentence-ending punctuation
    * ``max_duration`` seconds of screen time

    Pure function, so the grouping is unit tested without ffmpeg.
    """
    max_chars = max_chars or cfg.CAPTION_MAX_CHARS
    cues: list[dict] = []
    group: list[dict] = []

    def flush() -> None:
        if not group:
            return
        text = " ".join(str(w.get("text", "")).strip() for w in group).strip()
        if text:
            start = float(group[0]["start"])
            end = float(group[-1]["end"])
            cues.append(
                {
                    "start": start,
                    "end": min(max(end, start + min_duration), start + max_duration),
                    "text": wrap_text(text, max_chars),
                }
            )
        group.clear()

    for word in words:
        text = str(word.get("text", "")).strip()
        if not text:
            continue
        try:
            start = float(word.get("start", 0.0) or 0.0)
            end = float(word.get("end", start) or start)
        except (TypeError, ValueError):
            continue
        if end <= start:
            end = start + min_duration

        if group:
            previous = group[-1]
            gap = start - float(previous["end"])
            pending_text = " ".join(
                [str(w.get("text", "")).strip() for w in group] + [text]
            )
            too_many_words = len(group) + 1 > max_words
            too_wide = len(pending_text) > max_chars
            long_pause = gap > pause_break
            ran_too_long = (end - float(group[0]["start"])) > max_duration
            sentence_end = str(previous.get("text", "")).rstrip()[-1:] in ".?!"
            if too_many_words or too_wide or long_pause or ran_too_long or sentence_end:
                flush()

        group.append({"text": text, "start": start, "end": end})

    flush()
    return cues


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