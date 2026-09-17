import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const supabase = supabaseServer();
    const { video_id, content_type, content_text } = await req.json();

    if (!video_id || !content_type || !content_text) {
      return NextResponse.json(
        { message: 'video_id, content_type, and content_text are required' },
        { status: 400 }
      );
    }

    // Verify ownership of the video
    const { data: video } = await supabase
      .from('videos')
      .select('id')
      .eq('id', video_id)
      .eq('user_id', userId)
      .single();

    if (!video) {
      return NextResponse.json(
        { message: 'Video not found' },
        { status: 404 }
      );
    }

    const { data, error } = await supabase
      .from('repurposed_content')
      .insert({
        video_id,
        content_type,
        content_text,
        is_edited: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Create content error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}