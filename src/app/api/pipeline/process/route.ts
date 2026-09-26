import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { isValidServiceKey } from '@/lib/auth-utils';
import { triggerPipeline } from '@/lib/worker';

/**
 * Server-to-server entry point that kicks off the AI worker pipeline
 * (transcribe → analyze → clips → render). Reachable ONLY with the internal
 * service key. Returns immediately — the worker processes in the background.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isValidServiceKey(req)) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { videoId } = await req.json();
    if (!videoId) {
      return NextResponse.json(
        { message: 'videoId is required' },
        { status: 400 }
      );
    }

    const supabase = supabaseServer();

    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('id, user_id, storage_path, title, status')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      return NextResponse.json({ message: 'Video not found' }, { status: 404 });
    }

    if (video.status === 'completed' && video.storage_path) {
      return NextResponse.json(
        { message: 'Video already processed', videoId },
        { status: 200 }
      );
    }

    await supabase
      .from('videos')
      .update({
        status: 'processing',
        processing_stage: 'queued',
        error_message: null,
        processing_started_at: new Date().toISOString(),
      })
      .eq('id', videoId);

    const result = await triggerPipeline({
      id: video.id,
      user_id: video.user_id as string,
      storage_path: video.storage_path as string,
      title: video.title,
    });

    if (!result.triggered) {
      return NextResponse.json(
        {
          message: result.reason || 'Could not start the AI pipeline',
          detail: result.detail,
          fallback_as_available: true,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ message: 'Pipeline started', videoId }, { status: 202 });
  } catch (error) {
    console.error('Pipeline process error:', error);
    return NextResponse.json({ message: 'Processing failed' }, { status: 500 });
  }
}