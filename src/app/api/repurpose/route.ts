import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId, isValidServiceKey } from '@/lib/auth-utils';
import { generateText, getAIConfig, parseAIJSON } from '@/lib/ai-provider';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const isService = isValidServiceKey(req);
    if (!userId && !isService) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { videoId } = await req.json();

    if (!videoId) {
      return NextResponse.json(
        { message: 'videoId is required' },
        { status: 400 }
      );
    }

    const ai = getAIConfig();
    if (!ai) {
      return NextResponse.json(
        {
          message:
            'No AI provider configured. Add an API key to your environment ' +
            '(ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, or AI_API_KEY + AI_BASE_URL).',
        },
        { status: 500 }
      );
    }

    const supabase = supabaseServer();

    // Get video and transcript. When a user session is present, scope the
    // lookup to videos the user owns.
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

    // Generate content using the configured AI provider
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

    let generatedContent: {
      twitter?: unknown;
      blog?: unknown;
      emails?: unknown;
      linkedin?: unknown;
      shorts?: unknown;
    };
    try {
      generatedContent = parseAIJSON<typeof generatedContent>(text);
    } catch {
      throw new Error('AI provider returned invalid JSON');
    }

    // Save to database
    const rows = [
      {
        video_id: videoId,
        content_type: 'tweets',
        content_text: JSON.stringify(generatedContent.twitter, null, 2),
      },
      {
        video_id: videoId,
        content_type: 'blog',
        content_text: JSON.stringify(generatedContent.blog, null, 2),
      },
      {
        video_id: videoId,
        content_type: 'emails',
        content_text: JSON.stringify(generatedContent.emails, null, 2),
      },
      {
        video_id: videoId,
        content_type: 'linkedin',
        content_text: JSON.stringify(generatedContent.linkedin, null, 2),
      },
      {
        video_id: videoId,
        content_type: 'shorts',
        content_text: JSON.stringify(generatedContent.shorts, null, 2),
      },
    ];

    // Remove any previous content for this video, then insert fresh
    const { error: deleteError } = await supabase
      .from('repurposed_content')
      .delete()
      .eq('video_id', videoId);

    if (deleteError) {
      return NextResponse.json(
        { message: 'Failed to reset previous content' },
        { status: 500 }
      );
    }

    const { error: saveError } = await supabase
      .from('repurposed_content')
      .insert(rows);

    if (saveError) {
      return NextResponse.json(
        { message: 'Failed to save content' },
        { status: 500 }
      );
    }

    // Update video status
    await supabase
      .from('videos')
      .update({ status: 'completed' })
      .eq('id', videoId);

    return NextResponse.json({ message: 'Content generated successfully' });
  } catch (error) {
    console.error('Repurposing error:', error);
    const message =
      error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}