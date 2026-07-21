import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  recordDailyActivity,
  utcDateString,
} from "@/lib/activity/record-daily-activity";

// Cookie that remembers the last UTC day we recorded activity for this browser,
// so the once-per-day activity write doesn't run on every request.
const ACTIVITY_COOKIE = "hp_active_day";

export async function proxy(request: NextRequest) {
  const hasSupabaseEnv =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  if (!hasSupabaseEnv) {
    return NextResponse.next({
      request,
    });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Record daily-active-user activity for the admin dashboard, at most once per
  // day per browser. The getUser() call above has already refreshed the session,
  // so `user` reflects a valid signed-in user. RLS lets the user write only
  // their own activity row, and recordDailyActivity swallows its own errors, so
  // this can never break request handling.
  //
  // The cookie is only stamped when the write actually landed. Stamping it on a
  // failed write would suppress recording for the rest of the day, so a
  // transient failure (e.g. the table missing during a deploy) is instead
  // retried on the next request.
  if (user) {
    const today = utcDateString();
    if (request.cookies.get(ACTIVITY_COOKIE)?.value !== today) {
      const recorded = await recordDailyActivity(supabase, user.id);
      if (recorded) {
        supabaseResponse.cookies.set(ACTIVITY_COOKIE, today, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24,
        });
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
