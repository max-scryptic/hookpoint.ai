import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const hasSupabaseEnv =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  let userEmail: string | null = null;

  if (hasSupabaseEnv) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userEmail = user?.email ?? null;
  }

  return (
    <main className="shell">
      <section className="intro">
        <p className="eyebrow">Hookpoint.ai</p>
        <h1>Ready for Vercel and Supabase.</h1>
        <p className="lede">
          This starter is wired for Next.js hosting on Vercel and Supabase
          browser/server clients, with environment variables kept out of git.
        </p>
      </section>

      <section className="statusGrid" aria-label="Project setup status">
        <div className="statusItem">
          <span className="statusLabel">Vercel</span>
          <strong>Next.js detected</strong>
          <p>Import this GitHub repository in Vercel and it will use the Next.js preset.</p>
        </div>
        <div className="statusItem">
          <span className="statusLabel">Supabase</span>
          <strong>{hasSupabaseEnv ? "Environment configured" : "Environment needed"}</strong>
          <p>
            Add the public project URL and publishable key in Vercel, then pull them
            into local development.
          </p>
        </div>
        <div className="statusItem">
          <span className="statusLabel">Session</span>
          <strong>{userEmail ?? "No signed-in user"}</strong>
          <p>Server rendering already checks Supabase auth through secure cookies.</p>
        </div>
      </section>
    </main>
  );
}
