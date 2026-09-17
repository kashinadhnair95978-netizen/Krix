import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const supabase = supabaseServer();

    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Get videos error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const supabase = supabaseServer();

    const { searchParams } = new URL(req.url);
    const videoId = searchParams.get('id');

    if (!videoId) {
      return NextResponse.json(
        { message: 'Video id is required' },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: video } = await supabase
      .from('videos')
      .select('id, storage_path')
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