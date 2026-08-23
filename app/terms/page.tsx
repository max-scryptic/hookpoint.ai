import { LegalPage, LegalSection } from "@/components/legal-page"

export const metadata = {
  title: "Terms of Service · Viewlio",
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="20 August 2026">
      <LegalSection heading="1. These terms">
        <p>
          These terms are the agreement between you and Viewlio
          (&ldquo;Viewlio&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) for use of
          the Viewlio web application. By creating an account or using the
          service you accept them. If you do not accept them, do not use the
          service.
        </p>
      </LegalSection>

      <LegalSection heading="2. The service">
        <p>
          Viewlio connects to your YouTube channel, reads your videos and
          audience retention data, and produces AI generated analysis of hooks,
          pacing, packaging and drop-off points. Paid plans add deep analysis of
          source video you upload, cross-video intelligence across your own
          catalogue, and comparison reports between two of your videos.
        </p>
      </LegalSection>

      <LegalSection heading="3. Your account">
        <p>
          You need a Google account to sign in. You must be at least 16, give
          accurate information, and keep your account secure. You are responsible
          for everything done under your account. One account is for one person.
          Do not share credentials or resell access.
        </p>
      </LegalSection>

      <LegalSection heading="4. Connecting YouTube">
        <p>
          The service only works once you grant read access to your own YouTube
          channel. You confirm you own or are authorised to manage the channel
          and videos you analyse. Viewlio uses YouTube API Services, so the{" "}
          <a
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noreferrer"
          >
            YouTube Terms of Service
          </a>{" "}
          also apply to your use of it, and the{" "}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noreferrer"
          >
            Google Privacy Policy
          </a>{" "}
          covers Google&rsquo;s own handling of your data. You can revoke our
          access at any time at{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
          >
            Google security settings
          </a>
          . Doing so will stop most of the service from working.
        </p>
      </LegalSection>

      <LegalSection heading="5. Plans, credits and payment">
        <ul>
          <li>
            The Free plan includes a monthly allowance of video analyses. Paid
            plans add deep-analysis credits, larger allowances and uploads. The
            current plans, prices and limits are on the pricing page.
          </li>
          <li>
            Deep analysis is metered in credits, where one credit is one minute
            of source video analysed. Standard video analyses are metered per
            video.
          </li>
          <li>
            Allowances reset each billing period and do not roll over. Unused
            credits expire at the end of the period.
          </li>
          <li>
            Prices are in pounds sterling and, unless stated otherwise, exclude
            any applicable taxes. Payments are processed by Stripe under its own
            terms.
          </li>
          <li>
            Subscriptions renew automatically at the end of each period until
            cancelled. Cancel any time from settings, and your plan stays active
            until the end of the period you have paid for.
          </li>
          <li>
            Payments are non refundable except where the law requires otherwise.
            If an analysis fails through our fault, the credits it consumed are
            returned to your allowance.
          </li>
          <li>
            We may change prices or plan limits with reasonable notice. Changes
            take effect at your next renewal.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>
            Upload or analyse content you do not own or have the rights to use.
          </li>
          <li>
            Attempt to access another user&rsquo;s account, data or analyses.
          </li>
          <li>
            Scrape, reverse engineer, resell or redistribute the service or its
            output as a competing product.
          </li>
          <li>
            Circumvent usage limits, credits or billing, including by creating
            multiple accounts.
          </li>
          <li>
            Upload unlawful material, or anything that would put us in breach of
            the terms of Google, YouTube or our other providers.
          </li>
          <li>
            Overload or interfere with the service, its processing pipeline or
            its infrastructure.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="7. Your content">
        <p>
          Your videos, uploads and channel data stay yours. You grant us a
          limited licence to store, transcode, extract from and process that
          material for the sole purpose of providing the service to you, which
          includes sending relevant parts to the AI and transcoding providers we
          use. We do not use your content to train general purpose AI models, and
          we do not share it publicly. You can delete an analysis, and its
          uploads and derived media, at any time.
        </p>
      </LegalSection>

      <LegalSection heading="8. Analysis output">
        <p>
          Analyses are generated by AI models and are informational only. They can
          be incomplete or wrong, they are not a guarantee of views, retention,
          revenue or any other result, and they are not professional advice. You
          are responsible for the editorial decisions you make with them. You may
          use the output freely for your own content, including commercially.
        </p>
      </LegalSection>

      <LegalSection heading="9. Availability">
        <p>
          We aim to keep the service running but do not promise uninterrupted
          availability. Processing times vary with video length, queue depth and
          third party services. We may change, suspend or discontinue features.
          If we discontinue the service entirely we will give reasonable notice
          and refund any prepaid period not yet used.
        </p>
      </LegalSection>

      <LegalSection heading="10. Suspension and termination">
        <p>
          You can stop using the service and close your account at any time. We
          may suspend or terminate an account that breaches these terms, that
          creates a legal or security risk, or that fails to pay. On termination
          your right to use the service ends and we delete your data as described
          in our{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection heading="11. Disclaimers and liability">
        <p>
          The service is provided &ldquo;as is&rdquo;. To the extent the law
          allows, we exclude all implied warranties, including fitness for a
          particular purpose. We are not liable for lost profits, lost revenue,
          lost views, lost data or indirect or consequential loss. Our total
          liability in any twelve month period is limited to the amount you paid
          us in that period, or £50 if you are on a free plan. Nothing here
          excludes liability for death or personal injury caused by negligence,
          fraud, or anything else that cannot lawfully be excluded, and nothing
          affects the statutory rights of consumers.
        </p>
      </LegalSection>

      <LegalSection heading="12. Changes to these terms">
        <p>
          We may update these terms as the product changes. The date at the top
          shows the current version, and material changes will be notified in the
          app or by email. Continuing to use the service after a change means you
          accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection heading="13. Governing law">
        <p>
          These terms are governed by the laws of England and Wales, and the
          courts of England and Wales have exclusive jurisdiction. If you are a
          consumer elsewhere, you keep the protections of your local law.
        </p>
      </LegalSection>

      <LegalSection heading="14. Contact">
        <p>
          Questions about these terms:{" "}
          <a href="mailto:support@viewlio.ai">support@viewlio.ai</a>.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
