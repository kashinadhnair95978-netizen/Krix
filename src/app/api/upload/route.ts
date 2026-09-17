import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const title = (formData.get('title') as string) || 'Untitled video';

    if (!file) {
      return NextResponse.json({ message: 'No file provided' }, { status: 400 });
    }

    const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
    if (file.size > maxSize) {
      return NextResponse.json(
        { message: 'File exceeds 2GB limit' },
        { status: 400 }
      );
    }

    const supabase = supabaseServer();

    // Upload to Supabase Storage (service role bypasses the session-based RLS
    // policy; ownership is enforced via the user_id-prefixed path)
    const fileName = `${userId}/${Date.now()}-${file.name.replace(
      /[^a-zA-Z0-9.-]/g,
      '_'
    )}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('videos')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { message: uploadError.message },
        { status: 400 }
      );
    }

    // Create video record
    const { data: videoData, error: insertError } = await supabase
      .from('videos')
      .insert({
        user_id: userId,
        title,
        storage_path: uploadData.path,
        status: 'processing',
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { message: insertError.message },
        { status: 400 }
      );
    }

    // Trigger processing via background job
    const { error: processTriggerError } = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/process-video`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-key': process.env.INTERNAL_SERVICE_KEY || '',
        },
        body: JSON.stringify({ videoId: videoData.id }),
      }
    ).then(() => ({} as any), () => ({ error: 'Processing job unavailable' }));

    if (processTriggerError) {
      console.warn('Could not trigger processing:', processTriggerError);
    }

    return NextResponse.json(videoData, { status: 201 });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ message: 'Upload failed' }, { status: 500 });
  }
}