import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId, isValidServiceKey } from '@/lib/auth-utils';
import {
  type AIConfig,
  AIProviderConfigError,
  generateText,
  getAIStatusAsync,
  parseAIJSON,
  resolveAIConfig,
  AI_CONFIG_ERROR_CODE,
} from '@/lib/ai-provider';

/**
 * Automatic repurposing.
 *
 * Called two ways:
 *  1. by a signed-in user from the dashboard (session cookie), and
 *  2. by the local AI worker after a video finishes, over the server-to-server
 *     path with the `x-service-key` header (see ai-worker/app/services/
 *     repurpose_callback.py).
 *
 * Idempotency: rows are UPSERTED on (video_id, content_type) — required by the
 * unique index `idx_repurposed_content_video_type` in
 * src/components/supabase/ai_pipeline.sql. Re-running this endpoint for the same
 * video overwrites those five rows instead of accumulating duplicates, and rows
 * the user has edited (`is_edited`) are left alone unless `force` is set. Nothing
 * here deletes existing content, and the video's own status is never touched: the
 * worker owns that.
 */

/** One in-flight generation per video, so a retried callback cannot double-bill. */
const inFlight = new Map<string, Promise<unknown>>();

const CONTENT_TYPES = [
  'tweets',
  'blog',
  'emails',
  'linkedin',
  'shorts',
] as const;

type ContentType = (typeof CONTENT_TYPES)[number];

interface GeneratedContent {
  twitter?: unknown;
  blog?: unknown;
  emails?: unknown;
  linkedin?: unknown;
  shorts?: unknown;
}

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const isService = isValidServiceKey(req);
    if (!userId && !isService) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as { videoId?: string; force?: boolean };
    const videoId = body?.videoId;
    const force = body?.force === true;

    if (!videoId) {
      return NextResponse.json(
        { message: 'videoId is required' },
        { status: 400 }
      );
    }

    // Full configuration check, model availability included: a key whose model
    // the provider does not serve must be reported here as a 503 with the
    // variable to fix, not as a 500 from deep inside the provider.
    // `placeholderKeys` names env vars only - never key values.
    const resolved = await resolveAIConfig();
    if (!resolved.config) {
      const status = await getAIStatusAsync();
      return NextResponse.json(
        {
          error: AI_CONFIG_ERROR_CODE,
          message:
            'AUTO-REPURPOSE BLOCKED: no usable AI provider/model is configured. ' +
            (resolved.configError ?? status.reason),
          placeholderKeys: status.placeholderKeys,
        },
        { status: 503 }
      );
    }
    const ai = resolved.config;

    // Collapse concurrent requests for the same video onto one generation.
    const existing = inFlight.get(videoId);
    if (existing && !force) {
      await existing;
      return NextResponse.json({
        message: 'Content generation already in progress for this video',
        deduplicated: true,
      });
    }

    const run = generateAndStore(videoId, userId, isService, ai, force);
    inFlight.set(videoId, run);
    try {
      const result = await run;
      return NextResponse.json(result);
    } finally {
      if (inFlight.get(videoId) === run) inFlight.delete(videoId);
    }
  } catch (error) {
    console.error('Repurposing error:', error);
    // A provider that cannot serve the configured model/key is a configuration
    // error (503 with the fix), not a server error — and never a reason to
    // return fabricated content.
    if (error instanceof AIProviderConfigError) {
      return NextResponse.json(
        { error: AI_CONFIG_ERROR_CODE, message: error.message },
        { status: 503 }
      );
    }
    const message =
      error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}

async function generateAndStore(
  videoId: string,
  userId: string | null,
  isService: boolean,
  ai: AIConfig,
  force: boolean
) {
  const supabase = supabaseServer();

  // Get video and transcript. When a user session is present, scope the lookup
  // to videos that user owns. A service-key caller is the trusted worker and is
  // not scoped — the key is a shared secret, not a user credential.
  let query = supabase.from('videos').select('*').eq('id', videoId);
  if (userId) query = query.eq('user_id', userId);
  const { data: video, error: videoError } = await query.single();

  if (videoError || !video) {
    return NextResponse.json({ message: 'Video not found' }, { status: 404 });
  }

  if (!video.transcript) {
    return NextResponse.json(
      { message: 'Transcript not ready' },
      { status: 400 }
    );
  }

  // Existing rows decide what may be overwritten: a row the user has edited
  // (is_edited) is their work and is never silently replaced by machine output.
  // `force` is the only way to overwrite it, and it resets the flag so the row
  // is honestly marked as regenerated rather than still hand-edited.
  const { data: existingRows } = await supabase
    .from('repurposed_content')
    .select('content_type, content_text, is_edited')
    .eq('video_id', videoId);

  const edited = new Set(
    (existingRows ?? [])
      .filter((r) => r.is_edited)
      .map((r) => r.content_type as string)
  );

  // Skip regeneration when usable content already exists and no force was asked
  // for. This is what makes a retried worker callback cheap.
  if (!force) {
    const present = new Set(
      (existingRows ?? [])
        .filter((r) => r.content_text)
        .map((r) => r.content_type as string)
    );
    if (CONTENT_TYPES.every((type) => present.has(type))) {
      return NextResponse.json({
        message: 'Content already generated for this video',
        skipped: true,
        content_types: CONTENT_TYPES,
      });
    }
  }

  const system = `You are a content repurposing expert. Given a video transcript, generate high-quality repurposed content in valid JSON only — no markdown fences, no extra text.`;

  const prompt = `
Generate repurposed content for the video transcript below. Return valid JSON with exactly these keys:
1. "twitter" — 10 Twitter/X posts (different angles, viral potential) as an array of strings
2. "blog" — a blog outline object with a title and an array of SEO-optimized section headers
3. "emails" — 5 email subject lines and hooks as an array of strings
4. "linkedin" — 5 LinkedIn post hooks as an array of strings
5. "shorts" — 5 YouTube short hooks (30-60 seconds) as an array of strings

Transcript:
${video.transcript}
`;

  const text = await generateText(system, prompt, {
    maxTokens: 4000,
    config: ai,
  });

  let generated: GeneratedContent;
  try {
    generated = parseAIJSON<GeneratedContent>(text);
  } catch {
    throw new Error('AI provider returned invalid JSON');
  }

  const source: [ContentType, unknown][] = [
    ['tweets', generated.twitter],
    ['blog', generated.blog],
    ['emails', generated.emails],
    ['linkedin', generated.linkedin],
    ['shorts', generated.shorts],
  ];

  const preserved = new Set<ContentType>();
  const rows = source
    .map(([content_type, value]) => {
      const content_text = serialize(value);
      if (content_text === null) return null;
      // Never overwrite a row the user edited unless force was explicitly set.
      if (!force && edited.has(content_type)) {
        preserved.add(content_type);
        return null;
      }
      return {
        video_id: videoId,
        content_type,
        content_text,
        is_edited: false,
      };
    })
    .filter((row): row is { video_id: string; content_type: ContentType; content_text: string; is_edited: boolean } =>
      row !== null
    );

  if (rows.length === 0) {
    if (preserved.size > 0) {
      return NextResponse.json({
        message:
          'Nothing regenerated: every content type for this video was edited by the user',
        skipped: true,
        preserved: [...preserved],
      });
    }
    throw new Error('AI provider returned no usable content');
  }

  // Upsert on (video_id, content_type). Requires the unique index from
  // ai_pipeline.sql. Edited rows are excluded above unless force is set.
  const { error: saveError } = await supabase
    .from('repurposed_content')
    .upsert(rows, {
      onConflict: 'video_id,content_type',
      ignoreDuplicates: false,
    });

  if (saveError) {
    return NextResponse.json(
      { message: 'Failed to save content' },
      { status: 500 }
    );
  }

  // Note: videos.status is intentionally NOT updated here. The AI worker owns
  // that field; overwriting it from this route would mark a still-running
  // pipeline as completed.
  return NextResponse.json({
    message: 'Content generated successfully',
    content_types: rows.map((r) => r.content_type),
    ...(preserved.size > 0
      ? { preserved_edited: [...preserved] }
      : {}),
    source: isService ? 'worker' : 'user',
  });
}
