# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Viewlio is for YouTube creators and small creator teams who are trying to understand why viewers leave a video and what to change in the next upload. The primary user is usually reviewing analytics after publishing, comparing videos, or planning a follow-up video with evidence from their own channel rather than generic advice.

This record is inferred from the existing app copy, routes, prompts, billing plans, and YouTube/Supabase integration code.

## Product Purpose

Viewlio reads YouTube audience-retention data against the actual video, transcript, title, thumbnail, hook, pacing, and packaging. Its job is to turn drops, holds, gains, comparisons, and channel trends into specific next-upload decisions.

Success means the creator can point to a precise moment, understand what happened there, and leave with one concrete change to test next time.

## Positioning

Viewlio is not a generic analytics dashboard and not a generic AI content coach. Its defensible mechanism is joining the retention curve to the video itself, then grounding feedback in the footage, transcript, packaging, and comparable channel history.

The strongest claim is: analytics show where viewers left; Viewlio explains why they left and what to make differently.

## Operating Context

Users connect a YouTube channel, analyze individual videos, compare two videos, review channel-wide trends, collect tips, and generate video plans. Some paid workflows upload source files so the system can extract scenes, frames, OCR, and retention-window media.

The app has three major surfaces: a public marketing/pricing funnel, an authenticated creator workspace, and an admin workspace for billing, prompts, usage, costs, demo data, and user support.

Billing and entitlement flows are part of the product. Plans, GBP pricing, usage meters, deep credits, source-file upload access, and cancellation/resume flows must stay consistent with `lib/plans.ts` and the Stripe/Supabase code.

## Capabilities and Constraints

The codebase is a Next.js web app using React, Tailwind CSS v4, shadcn-style primitives, Base UI, Supabase, Stripe, YouTube APIs, S3/Supabase storage, ffmpeg, OCR, Qencode, and OpenAI-backed analysis prompts.

Product copy must not invent customer logos, testimonials, benchmark claims, retention results, or proof that is not present in the repo. Advice should stay grounded in the user's real analytics, transcript, video material, and saved channel history.

Existing terminology matters: analyzed videos, deep analysis, retention windows, packaging, title, thumbnail, hook, tips, checklist, video comparisons, channel trends, video plans, source files, credits, and plan grants.

## Brand Commitments

The public name is Viewlio. The repo name remains `hookpoint.ai`, but user-facing product surfaces should use Viewlio unless a deployment or legal context says otherwise.

The voice is evidence-led, direct, and calm. It should sound like a precise editor reviewing real material, not a hype coach. Prefer concrete verbs and specific observations over broad motivation.

The inline Viewlio mark in `components/brand-logo.tsx` is a committed identity asset. It uses the theme primary color, a white knockout mark, and a deliberately softer logo tile than the rest of the app chrome.

## Evidence on Hand

- Public positioning and metadata live in `app/page.tsx` and `app/layout.tsx`.
- The visual system is expressed primarily in `app/globals.css`, `tailwind.config.ts`, and `components/ui/*`.
- Plan names, limits, prices, and billing language live in `lib/plans.ts` and billing-related app/API routes.
- Analysis behavior and vocabulary live in `lib/prompts/defaults/*`, `lib/*analysis*`, `lib/*retention*`, `lib/*packaging*`, and `lib/video-plans/*`.

## Product Principles

- Ground every recommendation in observed video, transcript, packaging, or analytics evidence.
- Keep the creator's next action obvious; reports should collapse complexity into decisions.
- Preserve trust by showing what the system knows, what it inferred, and where data is incomplete.
- Treat pricing, credits, usage limits, and upload capabilities as product truth, not decorative marketing copy.
- Keep app surfaces efficient and scannable; creators should be able to review evidence quickly and return to making.

## Accessibility & Inclusion

This is a responsive web app. Maintain semantic controls, keyboard access, readable contrast in light and dark themes, clear focus states, and mobile layouts that preserve the full workflow rather than hiding important actions.
