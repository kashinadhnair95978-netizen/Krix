import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';

/**
 * GET /api/clips?videoId=<id>
 * Returns the rendered AI clips for a video the signed-in user owns, with
 * signed, expiring URLs for the video (playback/download) and thumbnail.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const videoId = searchParams.get('videoId');
    if (!videoId) {
      return NextResponse.json(
        { message: 'videoId is required' },
        { status: 400 }
      );
    }

    const supabase = supabaseServer();

    // Verify the video belongs to this user before returning anything.
    const { data: video } = await supabase
      .from('videos')
      .select('id')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();

    if (!video) {
      return NextResponse.json({ message: 'Video not found' }, { status: 404 });
    }

    const { data: clips, error } = await supabase
      .from('generated_clips')
      .select('*, clip_candidates(*)')
      .eq('video_id', videoId)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    const withUrls = await Promise.all(
      (clips || []).map(async (clip) => {
        let video_url: string | null = null;
        let thumb_url: string | null = null;

        if (clip.storage_path) {
          const { data: signed } = await supabase.storage
            .from('generated_clips')
            .createSignedUrl(clip.storage_path, 3600);
          video_url = signed?.signedUrl ?? null;
        }
        if (clip.thumb_path) {
          const { data: thumb } = await supabase.storage
            .from('generated_clips')
            .createSignedUrl(clip.thumb_path, 3600);
          thumb_url = thumb?.signedUrl ?? null;
        }

        return { ...clip, video_url, thumb_url };
      })
    );

    return NextResponse.json({ clips: withUrls });
  } catch (error) {
    console.error('Get clips error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}