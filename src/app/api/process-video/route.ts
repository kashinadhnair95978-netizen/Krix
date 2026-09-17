import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { isValidServiceKey } from '@/lib/auth-utils';
import { transcribeWithWhisper } from '@/lib/transcribe';

export async function POST(req: NextRequest) {
  try {
    // This endpoint is called by the upload route (server-to-server). It must
    // not be reachable by anonymous clients.
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
      .select('*')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      return NextResponse.json({ message: 'Video not found' }, { status: 404 });
    }

    if (video.status === 'completed') {
      return NextResponse.json({
        message: 'Video already processed',
        video,
      });
    }

    await supabase
      .from('videos')
      .update({
        status: 'processing',
        error_message: null,
        processing_started_at: new Date().toISOString(),
      })
      .eq('id', videoId);

    try {
      // 1. Transcribe (only if we don't already have a transcript)
      if (!video.transcript) {
        if (!video.storage_path) {
          throw new Error('No video file found to transcribe');
        }

        const { data: signed } = await supabase.storage
          .from('videos')
          .createSignedUrl(video.storage_path, 600);
        if (!signed?.signedUrl) {
          throw new Error('Could not create a download link for the video');
        }

        const fileRes = await fetch(signed.signedUrl);
        if (!fileRes.ok) {
          throw new Error(
            `Could not download the video from storage (${fileRes.status})`
          );
        }

        const bytes = await fileRes.arrayBuffer();
        const fileName = video.storage_path.split('/').pop() || 'video';
        // Extract the actual MIME type from the download if available.
        const mimeType = fileRes.headers.get('content-type') || 'video/mp4';

        const transcript = await transcribeWithWhisper(
          fileName,
          bytes,
          mimeType
        );

        const { error: transcriptError } = await supabase
          .from('videos')
          .update({ transcript })
          .eq('id', videoId);

        if (transcriptError) {
          throw new Error('Failed to save the transcript');
        }
      }

      // 2. Generate repurposed content (server-to-server call)
      const repurposeRes = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/repurpose`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-service-key': process.env.INTERNAL_SERVICE_KEY || '',
          },
          body: JSON.stringify({ videoId }),
        }
      );

      const repurposeResult = await repurposeRes.json().catch(() => ({}));

      if (!repurposeRes.ok) {
        throw new Error(
          repurposeResult.message || `Repurposing failed (${repurposeRes.status})`
        );
      }

      await supabase
        .from('videos')
        .update({
          status: 'completed',
          processing_ended_at: new Date().toISOString(),
        })
        .eq('id', videoId);

      return NextResponse.json({
        message: 'Video processed successfully',
        videoId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Processing failed';

      await supabase
        .from('videos')
        .update({
          status: 'failed',
          error_message: message,
          processing_ended_at: new Date().toISOString(),
        })
        .eq('id', videoId);

      return NextResponse.json({ message }, { status: 500 });
    }
  } catch (error) {
    console.error('Process video error:', error);
    return NextResponse.json({ message: 'Processing failed' }, { status: 500 });
  }
}