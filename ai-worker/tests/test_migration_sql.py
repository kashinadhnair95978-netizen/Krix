"""
Static checks for src/components/supabase/ai_pipeline.sql.

There is no psql / Supabase CLI / DDL access from a worker host, so the migration
cannot be executed here. These tests catch the mistakes that would make the file
fail on a clean database or silently corrupt pipeline bookkeeping:

  * unbalanced $$ function bodies
  * a statement that does not start with a SQL keyword (truncation / typo)
  * a trigger attached to a table that is created LATER in the file
  * a required table / bucket / policy missing
  * the worker writing the literal string "now()" as a timestamp
  * stage-vocabulary drift between the SQL CHECK, the TypeScript union and the
    stage names the worker actually writes

The last one is not hypothetical: the worker writes `finding_clips` while the
constraint used to allow only `detecting`, so every job would have failed its
database write the moment it reached clip selection.
"""

from __future__ import annotations

import re

import pytest

ROOT = __import__("pathlib").Path(__file__).resolve().parent.parent.parent
SQL_PATH = ROOT / "src/components/supabase/ai_pipeline.sql"
TS_PATH = ROOT / "src/types/index.ts"
PIPELINE_PATH = ROOT / "ai-worker/app/pipeline.py"
STORAGE_PATH = ROOT / "ai-worker/app/services/storage.py"

# Tables that the base schema already created before this migration runs.
PREEXISTING_TABLES = {"videos", "users", "storage"}

KEYWORDS = {
    "create", "alter", "drop", "insert", "update", "select", "set", "begin",
    "commit", "grant", "revoke", "comment", "do", "with", "delete", "end",
}


@pytest.fixture(scope="module")
def sql() -> str:
    return SQL_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def no_comments(sql: str) -> str:
    return "\n".join(re.sub(r"--.*$", "", line) for line in sql.splitlines())


def _split_statements(body: str) -> list[str]:
    """Split on top-level semicolons, keeping $$ blocks intact."""
    parts: list[str] = []
    current: list[str] = []
    i = 0
    while i < len(body):
        if body[i : i + 2] == "$$":
            j = body.find("$$", i + 2)
            if j == -1:
                break
            current.append(body[i : j + 2])
            i = j + 2
            continue
        if body[i] == ";":
            parts.append("".join(current))
            current = []
            i += 1
            continue
        current.append(body[i])
        i += 1
    if "".join(current).strip():
        parts.append("".join(current))
    return [p.strip() for p in parts if p.strip()]


def test_dollar_quoted_bodies_are_balanced(no_comments):
    body = re.sub(r"'[^']*'", "''", no_comments)
    assert body.count("$$") % 2 == 0, f"unbalanced $$ bodies: {body.count('$$')}"


def test_every_statement_starts_with_a_sql_keyword(no_comments):
    bad = []
    for stmt in _split_statements(no_comments):
        first = re.match(r"[A-Za-z_]+", stmt)
        if first and first.group(0).lower() not in KEYWORDS:
            bad.append(" ".join(stmt.split())[:60])
    assert not bad, f"statements with an unexpected first token: {bad}"


def test_no_trigger_is_created_before_its_table(no_comments):
    """A trigger on a not-yet-created table aborts the whole migration."""
    created: set[str] = set()
    offenders: list[tuple[int, str]] = []
    for number, line in enumerate(no_comments.splitlines(), 1):
        s = line.strip()
        m = re.search(r"CREATE TABLE IF NOT EXISTS\s+(\w+)", s, re.I)
        if m:
            created.add(m.group(1))
            continue
        m = re.search(r"CREATE TRIGGER\s+\w+[\s\S]*?ON\s+(\w+)", s, re.I)
        if not m:
            continue
        table = m.group(1)
        if table not in created and table not in PREEXISTING_TABLES:
            offenders.append((number, table))
    assert not offenders, (
        "trigger created before its table exists: "
        + ", ".join(f"line {n} -> {t}" for n, t in offenders)
    )


def test_trigger_ordering_check_actually_catches_the_bug():
    """Guard against the ordering rule silently becoming a no-op."""
    broken = (
        "CREATE TRIGGER t BEFORE UPDATE ON video_analysis_jobs\n"
        "  FOR EACH ROW EXECUTE FUNCTION f();\n"
        "CREATE TABLE IF NOT EXISTS video_analysis_jobs (id UUID);\n"
    )
    created: set[str] = set()
    offenders = []
    for number, line in enumerate(broken.splitlines(), 1):
        m = re.search(r"CREATE TABLE IF NOT EXISTS\s+(\w+)", line, re.I)
        if m:
            created.add(m.group(1))
            continue
        m = re.search(r"CREATE TRIGGER\s+\w+[\s\S]*?ON\s+(\w+)", line, re.I)
        if m and m.group(1) not in created and m.group(1) not in PREEXISTING_TABLES:
            offenders.append((number, m.group(1)))
    assert offenders, "the trigger-ordering check is toothless"


@pytest.mark.parametrize(
    "table", ["clip_candidates", "generated_clips", "video_analysis_jobs"]
)
def test_required_tables_are_created(sql, table):
    assert re.search(rf"CREATE TABLE IF NOT EXISTS\s+{table}\b", sql), (
        f"migration does not create {table}"
    )


def test_generated_clips_bucket_and_policies_exist(sql):
    assert re.search(r"bucket_id\s*=\s*'generated_clips'", sql), (
        "migration never creates the generated_clips bucket"
    )
    assert "storage.objects" in sql, "migration defines no storage.objects policies"


def test_videos_columns_the_worker_writes_are_added(sql):
    for column in ("processing_stage", "transcript_segments"):
        assert re.search(rf"ALTER TABLE videos ADD COLUMN IF NOT EXISTS {column}\b", sql), (
            f"migration does not add videos.{column}"
        )


def test_updated_at_is_maintained_by_a_trigger(sql):
    assert "CREATE OR REPLACE FUNCTION public.set_updated_at()" in sql
    for table in ("videos", "video_analysis_jobs"):
        assert re.search(rf"CREATE TRIGGER\s+\w+_updated_at[\s\S]*?ON\s+{table}\b", sql), (
            f"no updated_at trigger on {table}"
        )


def test_stage_vocabulary_matches_across_sql_typescript_and_worker(sql):
    m = re.search(r"CHECK \(processing_stage IN \(([^)]*)\)\)", sql, re.S)
    assert m, "no videos_processing_stage_check in the SQL"
    sql_stages = set(re.findall(r"'([a-z_]+)'", m.group(1)))

    ts = TS_PATH.read_text(encoding="utf-8")
    m = re.search(r"export type VideoProcessingStage =(.*?);", ts, re.S)
    assert m, "no VideoProcessingStage union in src/types/index.ts"
    ts_stages = set(re.findall(r"'([a-z_]+)'", m.group(1)))

    pipeline = PIPELINE_PATH.read_text(encoding="utf-8")
    worker_stages: set[str] = set()
    for call in re.finditer(r"update_video\((.*?)\)", pipeline, re.S):
        worker_stages |= set(re.findall(r'stage="([a-z_]+)"', call.group(1)))
    storage = STORAGE_PATH.read_text(encoding="utf-8")
    finalize = re.search(r"def finalize_video.*?(?=\ndef |\Z)", storage, re.S)
    if finalize:
        worker_stages |= set(
            re.findall(r'processing_stage"\]?\s*=\s*"([a-z_]+)"', finalize.group(0))
        )
        worker_stages |= set(
            re.findall(r'"processing_stage":\s*"([a-z_]+)"', finalize.group(0))
        )

    assert worker_stages, "could not detect the worker's stages (parser drift?)"
    assert worker_stages <= sql_stages, (
        f"the worker writes stages the SQL CHECK would reject: "
        f"{sorted(worker_stages - sql_stages)}"
    )
    assert sql_stages == ts_stages, (
        f"SQL/TypeScript drift: sql-only={sorted(sql_stages - ts_stages)} "
        f"ts-only={sorted(ts_stages - sql_stages)}"
    )


def test_worker_never_sends_the_literal_now_string():
    for path in (STORAGE_PATH, PIPELINE_PATH):
        text = path.read_text(encoding="utf-8")
        hits = re.findall(r'"(\w+)":\s*"now\(\)"', text)
        assert not hits, (
            f"{path.name} sends the literal 'now()' for {hits}; PostgREST cannot "
            f"call now(), it would store or reject the string"
        )


def test_repurpose_uniqueness_index_exists(sql):
    assert re.search(r"UNIQUE[^\n]*\(video_id[^\n]*content_type", sql, re.I) or (
        "idx_repurposed_content_video_type" in sql
    ), "migration must create the (video_id, content_type) unique index the upsert needs"
