import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';

interface RouteContext {
  params: { videoId: string };
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { videoId } = ctx.params;
    const supabase = supabaseServer();

    const { data: video, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();

    if (error || !video) {
      return NextResponse.json({ message: 'Video not found' }, { status: 404 });
    }

    return NextResponse.json(video);
  } catch (error) {
    console.error('Get video error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { videoId } = ctx.params;
    const supabase = supabaseServer();

    const { data: video } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();

    if (!video) {
      return NextResponse.json({ message: 'Video not found' }, { status: 404 });
    }

    if (video.storage_path) {
      await supabase.storage.from('videos').remove([video.storage_path]);
    }

    const { error } = await supabase
      .from('videos')
      .delete()
      .eq('id', videoId)
      .eq('user_id', userId);

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    return NextResponse.json({ message: 'Video deleted' });
  } catch (error) {
    console.error('Delete video error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}