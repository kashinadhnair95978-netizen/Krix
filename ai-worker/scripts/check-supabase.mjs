/**
 * Print the live Supabase schema for the tables the AI worker touches.
 * Read-only: it never writes. Run it from the repo root:
 *
 *   node ai-worker/scripts/check-supabase.mjs
 *
 * Use it AFTER applying src/components/supabase/ai_pipeline.sql to confirm the
 * AI tables, columns and the generated_clips bucket really exist.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TABLES = [
  "videos",
  "users",
  "clip_candidates",
  "generated_clips",
  "video_analysis_jobs",
  "repurposed_content",
];

// PostgREST cannot describe a table, so probe one row to learn its shape.
for (const table of TABLES) {
  const { data, error } = await db.from(table).select("*").limit(1);
  if (error) {
    console.log(`\n=== ${table} === ERROR ${error.code}: ${error.message}`);
    continue;
  }
  const cols = data?.length ? Object.keys(data[0]) : "(empty table — columns unknown via REST)";
  console.log(`\n=== ${table} === rows<=1, cols=${JSON.stringify(cols)}`);
}

const { data: buckets } = await db.storage.listBuckets();
console.log(`\n=== buckets === ${JSON.stringify((buckets ?? []).map((b) => b.id))}`);
