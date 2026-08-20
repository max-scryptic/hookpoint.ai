import { LegalPage, LegalSection } from "@/components/legal-page"

export const metadata = {
  title: "Privacy Policy · Hookpoint.ai",
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="20 August 2026">
      <LegalSection heading="1. Who we are">
        <p>
          Hookpoint.ai (&ldquo;Hookpoint&rdquo;, &ldquo;we&rdquo;,
          &ldquo;us&rdquo;) provides a web application that analyses a YouTube
          creator&rsquo;s own videos and audience retention data, and returns
          insights about hooks, pacing, packaging and drop-off points. This
          policy explains what personal data we collect, why we collect it, and
          what you can do about it. We are the data controller for that data.
        </p>
        <p>
          Questions about this policy or your data:{" "}
          <a href="mailto:privacy@hookpoint.ai">privacy@hookpoint.ai</a>.
        </p>
      </LegalSection>

      <LegalSection heading="2. Data we collect">
        <ul>
          <li>
            <strong>Account data.</strong> When you sign in with Google we
            receive your name, email address and profile picture, and we store
            them against your account.
          </li>
          <li>
            <strong>Google authorisation.</strong> We store the OAuth refresh
            token issued by Google so the service can keep reading your YouTube
            data between sessions. It is held server side only and is never
            exposed to the browser.
          </li>
          <li>
            <strong>YouTube data.</strong> With your permission we read data for
            your own channel through the YouTube Data API and the YouTube
            Analytics API: video metadata such as titles, descriptions,
            thumbnails, tags and publish dates; audience retention curves, views,
            watch time and related analytics; and captions or transcripts for
            your own videos.
          </li>
          <li>
            <strong>Files you upload.</strong> If you run a deep analysis you can
            upload the source video file for a video. We also store material
            derived from it, including a lower resolution proxy, extracted frames
            and audio, transcripts, on screen text recovered by OCR, and scene
            and event data.
          </li>
          <li>
            <strong>Analysis output.</strong> The insights, scores, comparison
            reports, tips and checklists generated for you, plus any feedback or
            ratings you give on them.
          </li>
          <li>
            <strong>Billing data.</strong> Your plan, subscription status, usage
            counters, credit consumption, invoices and any cancellation feedback
            you submit. Card details are handled by Stripe and never reach our
            servers.
          </li>
          <li>
            <strong>Technical data.</strong> Session cookies used to keep you
            signed in, plus standard server and error logs from our hosting and
            database providers.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. How we use it">
        <ul>
          <li>To create and run your account and keep you signed in.</li>
          <li>
            To fetch your YouTube videos and retention data and produce the
            analyses, comparisons and recommendations you ask for.
          </li>
          <li>
            To build your private cross-video library, so later analyses can draw
            on patterns across your own channel.
          </li>
          <li>
            To meter usage against your plan, take payment, and send
            service notifications such as an analysis finishing.
          </li>
          <li>
            To keep the service secure, debug faults, monitor processing costs
            and improve how the product works.
          </li>
        </ul>
        <p>
          We do not sell your data, we do not use it for advertising, and we do
          not use your content to train our own or any third party&rsquo;s
          general purpose AI models.
        </p>
      </LegalSection>

      <LegalSection heading="4. Legal bases">
        <p>
          Where UK or EU data protection law applies, we rely on: performance of
          our contract with you, for running the service and billing you;
          legitimate interests, for security, fault diagnosis, cost control and
          product improvement; consent, which you give through the Google
          permission screen when you connect your YouTube account and can
          withdraw at any time; and legal obligation, for tax and accounting
          records.
        </p>
      </LegalSection>

      <LegalSection heading="5. YouTube API Services">
        <p>
          Hookpoint uses YouTube API Services. By using the service you also
          agree to the{" "}
          <a
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noreferrer"
          >
            YouTube Terms of Service
          </a>
          , and Google&rsquo;s handling of your data is described in the{" "}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noreferrer"
          >
            Google Privacy Policy
          </a>
          .
        </p>
        <p>
          You can revoke Hookpoint&rsquo;s access to your Google and YouTube data
          at any time at{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
          >
            Google security settings
          </a>
          . Revoking access stops any further reading of your YouTube data. To
          also remove data we already hold, delete it in the app or contact us.
        </p>
        <p>
          We only request read access to your own channel, plus the caption scope
          Google requires to download captions from videos you own. We never
          request access to other people&rsquo;s channels, and we do not post,
          edit or delete anything on YouTube.
        </p>
      </LegalSection>

      <LegalSection heading="6. AI processing">
        <p>
          Analyses are produced by sending relevant material to third party AI
          models. Depending on the analysis this can include video metadata,
          retention figures, transcripts, and extracted frames and audio clips
          from your video. We send only what a given analysis needs, and our AI
          provider processes it on our instructions and under terms that prohibit
          using it to train their models.
        </p>
      </LegalSection>

      <LegalSection heading="7. Who we share it with">
        <p>
          We share data only with service providers that run the product on our
          behalf:
        </p>
        <ul>
          <li>
            <strong>Google / YouTube</strong>, the source of your channel data
            and our sign-in provider.
          </li>
          <li>
            <strong>Supabase</strong>, for authentication, database and file
            storage.
          </li>
          <li>
            <strong>Vercel</strong>, for application hosting.
          </li>
          <li>
            <strong>OpenAI</strong>, for the AI analysis described above.
          </li>
          <li>
            <strong>Qencode</strong>, for transcoding uploaded video into an
            analysis proxy.
          </li>
          <li>
            <strong>Stripe</strong>, for payments, invoices and card handling.
          </li>
        </ul>
        <p>
          We may also disclose data where the law requires it, or to establish or
          defend legal claims. If the business is ever sold or reorganised, data
          may transfer to the acquirer under this policy.
        </p>
      </LegalSection>

      <LegalSection heading="8. International transfers">
        <p>
          Some of these providers process data outside the UK and EEA, mainly in
          the United States. Where that happens we rely on the transfer
          safeguards those providers offer, such as standard contractual clauses.
        </p>
      </LegalSection>

      <LegalSection heading="9. Retention and deletion">
        <p>
          We keep your account data for as long as your account exists. Analysed
          videos, uploads and derived media stay until you delete them or close
          your account. Deleting an analysis removes the analysis and the data
          hanging off it, including extracted media. Closing your account removes
          your profile, stored Google token, analyses and uploads, other than
          records we must keep for tax, accounting or fraud prevention, such as
          invoices, and backups which age out on their normal cycle. To close
          your account, email us and we will action it.
        </p>
      </LegalSection>

      <LegalSection heading="10. Your rights">
        <p>
          Subject to local law you can ask for a copy of your data, correct it,
          delete it, restrict or object to processing, or receive it in a
          portable format. Email{" "}
          <a href="mailto:privacy@hookpoint.ai">privacy@hookpoint.ai</a> and we
          will respond within one month. If you are in the UK you can also
          complain to the Information Commissioner&rsquo;s Office, and if you are
          in the EEA to your local supervisory authority.
        </p>
      </LegalSection>

      <LegalSection heading="11. Security">
        <p>
          Data is encrypted in transit. Your Google refresh token sits in a table
          that is unreachable with the public API key and readable only by our
          server. Database rows are protected by row level security so one
          account cannot read another&rsquo;s data, and uploaded files are served
          through short lived signed URLs scoped to your own account. No system is
          perfectly secure, but we take these controls seriously and review them
          as the product changes.
        </p>
      </LegalSection>

      <LegalSection heading="12. Cookies">
        <p>
          We use cookies only to keep you signed in and to remember interface
          preferences such as theme and sidebar state. We do not use advertising
          or cross site tracking cookies.
        </p>
      </LegalSection>

      <LegalSection heading="13. Children">
        <p>
          Hookpoint is not intended for anyone under 16. We do not knowingly
          collect data from children. If you believe a child has given us data,
          contact us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection heading="14. Changes">
        <p>
          We may update this policy as the product changes. The date at the top
          shows the current version, and material changes will be notified in the
          app or by email.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
