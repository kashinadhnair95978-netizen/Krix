import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';

interface RouteContext {
  params: { id: string };
}

type SupabaseLike = ReturnType<typeof supabaseServer>;

/**
 * Ownership check for a single repurposed content row.
 *
 * `videos!inner(user_id)` is a many-to-one embed, so PostgREST returns a single
 * OBJECT — not an array. The previous code read `.length` and `[0]` on it:
 * `.length` was `undefined`, the guard evaluated false, and
 * `(videos)[0].user_id` threw a TypeError that the surrounding catch swallowed.
 * Both endpoints therefore answered 500 for every request and the ownership
 * check never actually ran.
 *
 * Returns false for a missing row, an unjoined row, and another user's row —
 * the caller answers 404 in all three cases so ids cannot be probed.
 */
async function ownsContent(
  supabase: SupabaseLike,
  contentId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('repurposed_content')
    .select('id, videos!inner(user_id)')
    .eq('id', contentId)
    .maybeSingle();

  // An empty result is "not mine", not a server error. A real transport or
  // permission failure is logged and also treated as "not mine" so this check
  // can never be the thing that turns into a 500.
  if (error && (error as { code?: string }).code !== 'PGRST116') {
    console.error('content ownership lookup failed:', error.message);
    return false;
  }
  if (!data || typeof data !== 'object') return false;

  const video = (data as { videos?: unknown }).videos;
  if (!video || typeof video !== 'object' || Array.isArray(video)) return false;
  const owner = (video as { user_id?: unknown }).user_id;
  return typeof owner === 'string' && owner === userId;
}

// GET /api/content/[id]
// `id` is treated as a video id: returns all repurposed content for a video.
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const videoId = ctx.params.id;
    const supabase = supabaseServer();

    // Verify the video belongs to the user before listing content
    const { data: video } = await supabase
      .from('videos')
      .select('id')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();

    if (!video) {
      return NextResponse.json({ message: 'Video not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('repurposed_content')
      .select('*')
      .eq('video_id', videoId)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Get content error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

// PUT /api/content/[id]
// `id` is treated as a content item id: updates a single repurposed item.
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const contentId = ctx.params.id;
    const body = await req.json();
    const supabase = supabaseServer();

    if (!(await ownsContent(supabase, contentId, userId))) {
      return NextResponse.json({ message: 'Content not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.content_text === 'string') {
      updates.content_text = body.content_text;
    }
    if (typeof body.is_edited === 'boolean') {
      updates.is_edited = body.is_edited;
      updates.edited_by_user_at = new Date().toISOString();
    }
    if (typeof body.posted_to_platform === 'string') {
      updates.posted_to_platform = body.posted_to_platform;
      updates.posted_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('repurposed_content')
      .update(updates)
      .eq('id', contentId)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json(
        { message: error?.message || 'Content not found' },
        { status: 400 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Update content error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

// DELETE /api/content/[id]
// `id` is treated as a content item id: deletes a single repurposed item.
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const contentId = ctx.params.id;
    const supabase = supabaseServer();

    if (!(await ownsContent(supabase, contentId, userId))) {
      return NextResponse.json({ message: 'Content not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('repurposed_content')
      .delete()
      .eq('id', contentId);

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    return NextResponse.json({ message: 'Content deleted' });
  } catch (error) {
    console.error('Delete content error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}