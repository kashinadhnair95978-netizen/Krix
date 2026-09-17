import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { supabaseServer } from './supabase';

/**
 * True when the request carries the correct internal service key.
 * Used for server-to-server calls (e.g. upload → process-video → repurpose)
 * that have no browser session.
 */
export function isValidServiceKey(req: NextRequest | Request): boolean {
  const secret = process.env.INTERNAL_SERVICE_KEY;
  if (!secret) return false;
  const provided =
    req.headers.get('x-service-key') ||
    (req as NextRequest).headers?.get('x-service-key');
  if (!provided) return false;
  return provided === secret;
}

export async function getUserId(req?: NextRequest): Promise<string | null> {
  try {
    if (req) {
      const cookieClient = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return req.cookies.getAll();
            },
            setAll(
              cookiesToSet: {
                name: string;
                value: string;
                options: CookieOptions;
              }[]
            ) {
              cookiesToSet.forEach(({ name, value }) =>
                req.cookies.set(name, value)
              );
            },
          },
        }
      );
      const {
        data: { user },
      } = await cookieClient.auth.getUser();
      return user?.id ?? null;
    }

    // Fallback: try header passed by client (x-user-id) — only trust it
    // when the caller also sends the access token. This is a simplified path;
    // production should always verify via cookie/session.
    return null;
  } catch (error) {
    console.error('getUserId error:', error);
    return null;
  }
}

export async function getUser(req?: NextRequest) {
  try {
    const supabase = supabaseServer();

    if (req) {
      const cookieClient = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return req.cookies.getAll();
            },
            setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
              cookiesToSet.forEach(({ name, value }) =>
                req.cookies.set(name, value)
              );
            },
          },
        }
      );
      const {
        data: { user },
      } = await cookieClient.auth.getUser();
      if (user) return user;
    }

    const {
      data: { user: serviceUser },
    } = await supabase.auth.getUser();
    return serviceUser;
  } catch (error) {
    console.error('getUser error:', error);
    return null;
  }
}