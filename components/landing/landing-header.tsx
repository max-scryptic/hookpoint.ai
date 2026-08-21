"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { MenuIcon, MoonIcon, SunIcon, XIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { BrandLogo } from "@/components/brand-logo"
import { cn } from "@/lib/utils"

// The landing page is one page, so the nav is not navigation in the usual
// sense: every link is an anchor that scrolls to a section further down. The
// only links that leave the page are the account ones on the right.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

const SECTIONS = [
  { id: "how-it-works", label: "How it works" },
  { id: "features", label: "Features" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
] as const

export function LandingHeader({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  // The bar is transparent over the hero and gains a background once the page
  // moves, so the hero art is never cut off by a solid strip on first paint.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // Which section the reader is currently in, so the matching nav link can say
  // so. Driven by an observer rather than scroll maths: it costs nothing while
  // the page is still and needs no thresholds tuned per section height.
  useEffect(() => {
    const elements = SECTIONS.map(({ id }) =>
      document.getElementById(id)
    ).filter((element): element is HTMLElement => element != null)

    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) setActiveSection(visible.target.id)
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    )

    elements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  // A tapped anchor in the mobile sheet should close it on the way out.
  useEffect(() => {
    if (!menuOpen) return
    const onResize = () => setMenuOpen(false)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [menuOpen])

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-200",
        scrolled || menuOpen
          ? "border-b bg-background/85 backdrop-blur-lg"
          : "border-b border-transparent"
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight"
        >
          <BrandLogo className="size-8" priority />
          Hookpoint.ai
        </Link>

        <nav className="ml-6 hidden items-center gap-1 md:flex">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                activeSection === section.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />

          {isAuthenticated ? (
            <Link
              href="/analyse-video"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go to app
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Start free
              </Link>
            </>
          )}

          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          >
            {menuOpen ? (
              <XIcon className="size-5" />
            ) : (
              <MenuIcon className="size-5" />
            )}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="border-t bg-background/95 px-4 py-3 backdrop-blur-lg md:hidden">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {section.label}
            </a>
          ))}
          {!isAuthenticated && (
            <Link
              href="/login"
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
            >
              Log in
            </Link>
          )}
        </nav>
      )}
    </header>
  )
}

// A two-state light and dark switch. The app itself offers a third "system"
// option, but a marketing page wants one small control, so this flips between
// the two resolved states and leaves the richer picker to the settings screen.
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <button
      type="button"
      aria-label="Toggle light and dark theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {/* Which glyph shows is decided by the theme class on the document rather
          than by React state. The server cannot know the reader's theme, so
          picking the icon in render would either mismatch on hydration or need
          a mounted flag and a frame of empty space; CSS just gets it right. */}
      <SunIcon className="hidden size-[1.15rem] dark:block" />
      <MoonIcon className="size-[1.15rem] dark:hidden" />
    </button>
  )
}
