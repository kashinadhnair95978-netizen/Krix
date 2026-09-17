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
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - 13);
    const sinceIso = since.toISOString();

    const [{ data: videos }, { data: posts }] = await Promise.all([
      supabase
        .from('videos')
        .select('created_at, status')
        .eq('user_id', userId),
      supabase
        .from('repurposed_content')
        .select('created_at, videos!inner(user_id)')
        .filter('videos.user_id', 'eq', userId)
        .gte('created_at', sinceIso),
    ]);

    const days: { date: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      days.push({
        date: d.toISOString().slice(0, 10),
        count: 0,
      });
    }

    const bucket = new Map(days.map((d) => [d.date, 0]));
    for (const post of posts || []) {
      const date = (post.created_at as string).slice(0, 10);
      if (bucket.has(date)) bucket.set(date, (bucket.get(date) || 0) + 1);
    }

    return NextResponse.json({
      totalVideos: videos?.length || 0,
      completedVideos:
        videos?.filter((v) => v.status === 'completed').length || 0,
      processingVideos:
        videos?.filter((v) => v.status === 'processing').length || 0,
      postsThisWeek: days
        .slice(-7)
        .reduce((sum, d) => sum + (bucket.get(d.date) || 0), 0),
      posts: days.map((d) => ({ ...d, count: bucket.get(d.date) || 0 })),
    });
  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}