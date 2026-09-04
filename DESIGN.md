---
name: Viewlio
description: Evidence-led video retention analysis for YouTube creators.
colors:
  background: "oklch(0.958 0.006 264)"
  foreground: "oklch(0.18 0.02 264)"
  card: "oklch(1 0 0)"
  muted: "oklch(0.972 0.008 264)"
  primary: "oklch(0.54 0.2 264)"
  primary-foreground: "oklch(0.985 0 0)"
  secondary: "oklch(0.975 0.013 264)"
  accent: "oklch(0.95 0.03 264)"
  border: "oklch(0.91 0.012 264)"
  landing-band: "oklch(0.925 0.007 264)"
  destructive: "oklch(0.577 0.245 27.325)"
typography:
  display:
    fontFamily: "Sora, Inter, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "normal"
  headline:
    fontFamily: "Sora, Inter, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "normal"
  title:
    fontFamily: "Sora, Inter, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "normal"
rounded:
  base: "2px"
  xs: "1px"
  sm: "1px"
  md: "1.5px"
  lg: "2px"
  xl: "2.5px"
  brand: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section-y: "80px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-primary-large:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    height: "44px"
    padding: "0 24px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "16px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
---

# Design System: Viewlio

## Overview

**Creative North Star: "The Retention Lab"**

Viewlio's interface should feel like a working analysis bench for creators: focused, evidence-rich, and calm enough to make judgment easier. The system favors square geometry, restrained tonal layers, exact labels, and dense but readable layouts over decorative panels or broad marketing flourish.

The visual language is built around one disciplined blue/indigo family. Color marks action, focus, selection, and chart identity; structure comes mostly from lightness, borders, and spacing. The product can be expressive on the public landing page, but the authenticated workspace should stay quiet and operational.

**Key Characteristics:**

- Square-cornered product chrome with one deliberate softer exception for the brand mark.
- Blue/indigo as the controlling family, with chart colors used only when separation is needed.
- Sora headings over Inter body text for a precise editorial/technical tone.
- Tonal surface steps instead of heavy shadows or glass effects.
- Evidence-first layouts that keep moments, metrics, tips, and controls close together.

## Colors

The palette is a cool blue/indigo system with neutral surface tiers. Light mode uses subtle chroma at the brand hue; dark mode shifts into deep navy while preserving the same family.

### Primary

- **Signal Blue** (`primary`): Use for primary actions, focus rings, active navigation, links, selected states, and the brand tile.
- **Signal Ink** (`primary-foreground`): Use only on primary fills and other high-chroma surfaces that require inverted text.

### Secondary

- **Analysis Mist** (`accent`, `secondary`, `muted`): Use for selected tracks, nested widgets, muted sections, and low-emphasis controls.
- **Landing Band** (`landing-band`): Use for public landing page section alternation so the page reads as a sequence of stops.

### Neutral

- **Cool Page** (`background`): The base page tier.
- **White Work Surface** (`card`, `popover`, `sidebar` in light mode): The main container tier for cards, filters, popovers, and workspace panels.
- **Indigo Ink** (`foreground`): Primary text.
- **Quiet Border** (`border`, `input`): Structural rules, table dividers, field strokes, and card outlines.

### Named Rules

**The One-Hue Rule.** Interface tints should stay on the brand hue unless a chart, badge taxonomy, destructive state, or external asset genuinely needs separation.

**The Signal Rarity Rule.** Primary blue should mark choices and destinations. Do not flood whole app surfaces with high-chroma blue.

## Typography

**Display Font:** Sora with Inter and system sans fallbacks.
**Body Font:** Inter with system sans fallbacks.

**Character:** Sora gives headings a compact, technical confidence; Inter keeps reports, tables, controls, and long evidence readable. The pairing should feel editorial and analytical, not playful or ornamental.

### Hierarchy

- **Display** (600, `text-4xl` to `lg:text-6xl`, 1.05): Public hero headlines and rare first-screen statements.
- **Headline** (600, `text-3xl` to `sm:text-4xl`, tight): Major landing sections and route-level workspace headings.
- **Title** (500, `text-base`, snug): Card titles, panel headers, table section titles, and compact dashboard headings.
- **Body** (400, `text-sm` to `text-base`, relaxed): Reports, explanations, settings copy, legal copy, and form help.
- **Label** (500 to 600, `text-xs` to `text-sm`): Buttons, tabs, badges, filters, table headers, and metric labels.

### Named Rules

**The No-Theater Type Rule.** Do not introduce italic serif, novelty display faces, gradient text, negative tracking, or oversized hero type inside compact app surfaces.

## Layout

The app uses constrained center columns for public pages and dense bounded panels for authenticated workflows. Public sections use generous vertical rhythm (`py-20` and up) and a `max-w-6xl` content width. App and admin surfaces favor predictable side navigation, tables, tabs, filters, cards, and compact control rows.

Responsive behavior should preserve the whole workflow. Controls may stack, tables may become lists, and charts may simplify, but important actions and evidence should not disappear on mobile.

## Elevation & Depth

Depth is mostly tonal: page, card, muted widget, popover, and sidebar tiers do the work. Light mode can use restrained shadows for landing CTAs or hover emphasis. Dark mode relies on lightness steps because heavy black shadows disappear against the navy surface.

### Named Rules

**The Tonal Depth Rule.** Use surface tokens, borders, and spacing before adding shadows. A shadow should respond to state or make a floating layer legible, not decorate a static card.

## Shapes

The product chrome is square to the eye. The base radius is 2px, and the Tailwind radius ramp stays between roughly 1px and 4px. This keeps cards, controls, tabs, fields, and popovers crisp while preserving anti-aliased corners.

The brand mark tile is the deliberate exception: it uses `--radius-brand` (10px) because the mark was drawn for that silhouette. User avatars may remain circular.

## Components

### Buttons

- **Shape:** Compact, square-cornered controls derived from the radius ramp.
- **Primary:** Signal Blue fill with Signal Ink text. Default app buttons are 32px high; landing CTAs may use 44px height and stronger shadow.
- **Hover / Focus:** Hover darkens or softens the fill. Focus uses the primary ring treatment. Active state may translate down by 1px.
- **Secondary / Ghost:** Use tonal fills or transparent hover states rather than extra outlines unless separation is needed.

### Cards / Containers

- **Corner Style:** Crisp corners from the radius ramp.
- **Background:** Main cards use the white/card tier in light mode and the card tier in dark mode.
- **Shadow Strategy:** Flat by default; use borders/rings and surface tiers for separation.
- **Internal Padding:** 12px to 16px for dense product cards; more only for public landing sections.

### Inputs / Fields

- **Style:** 32px high by default, card background, border/input stroke, compact horizontal padding.
- **Focus:** Primary-colored border/ring treatment.
- **Error / Disabled:** Destructive ring for invalid state; disabled fields lower opacity and reduce contrast through the input token.

### Navigation

The public header is fixed, transparent over the hero, and gains a blurred background after scroll. App navigation should stay functional and scan-first, with active states using the accent tier and foreground text rather than loud fills.

### Charts and Analysis Visuals

Charts may use the provided chart tokens to separate series. Report visuals should keep labels close to the evidence they explain and avoid making chart color carry meaning alone.

## Do's and Don'ts

### Do:

- **Do** use semantic tokens from `app/globals.css` instead of hardcoded visual values.
- **Do** keep app surfaces dense, aligned, and readable for repeated analysis work.
- **Do** preserve light and dark theme parity when adding new UI.
- **Do** make each report/control state obvious without relying only on color.
- **Do** keep public-page motion tied to attention, reveal, or pointer state.

### Don't:

- **Don't** introduce rounded SaaS cards, glassmorphism, glow-heavy panels, bokeh/orb backgrounds, or purple-blue gradient hero defaults.
- **Don't** nest decorative cards inside cards when a full-width section, table, list, or grouped row would communicate hierarchy more clearly.
- **Don't** make the workspace feel like a marketing landing page; the authenticated app is an Operate surface.
- **Don't** fabricate proof, social evidence, performance claims, or analytics outcomes in visual copy.
