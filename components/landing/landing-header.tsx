"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { MenuIcon, XIcon } from "lucide-react"

import { BrandLogo } from "@/components/brand-logo"
import { cn } from "@/lib/utils"

// The landing page is one page, so the nav is not navigation in the usual
// sense: every link is an anchor that scrolls to a section further down. The
// only links that leave the page are the account ones on the right.
//
// LOOK: a fixed bar with no fill of its own over the hero, typographic links at
// 13px, and one high-contrast control at the end. That control is the white
// pill, not the acid-lime button: lime is spent on the action inside the page,
// and two of them in one view would leave neither reading as the one to press.
//
// There is no theme switch here. The page holds its own dark theme whatever the
// app is set to (see #landing-root in globals.css), so a control offering to
// change it would have nothing to change. The app's own switch is in settings.
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
        "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-200",
        scrolled || menuOpen
          ? "border-graphite bg-void/80 backdrop-blur-lg"
          : "border-transparent"
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-[16px] font-w510 tracking-ui text-paper"
        >
          {/* White tile, not lime: the mark identifies the product, it is not
              something to press. */}
          <BrandLogo className="size-7 rounded-[6px] bg-paper" />
          Viewlio
        </Link>

        <nav className="ml-8 hidden items-center gap-1 md:flex">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={cn(
                "px-3 py-2 text-[13px] transition-colors",
                activeSection === section.id
                  ? "text-paper"
                  : "text-mist hover:text-paper"
              )}
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {isAuthenticated ? (
            <Link
              href="/analyse-video"
              className="inline-flex h-9 items-center rounded-full bg-paper px-4 text-[13px] font-w510 tracking-ui text-void transition-colors hover:bg-bone"
            >
              Go to app
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden h-9 items-center rounded-[6px] px-3 text-[13px] text-mist transition-colors hover:text-paper sm:inline-flex"
              >
                Log in
              </Link>
              {/* The one high-contrast control in the bar. */}
              <Link
                href="/signup"
                className="inline-flex h-9 items-center rounded-full bg-paper px-4 text-[13px] font-w510 tracking-ui text-void transition-colors hover:bg-bone"
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
            className="inline-flex size-9 items-center justify-center rounded-[6px] text-fog transition-colors hover:bg-white/5 hover:text-paper md:hidden"
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
        <nav className="border-t border-graphite bg-void/95 px-4 py-3 backdrop-blur-lg md:hidden">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={() => setMenuOpen(false)}
              className="block rounded-[6px] px-3 py-2.5 text-[13px] text-mist transition-colors hover:bg-white/5 hover:text-paper"
            >
              {section.label}
            </a>
          ))}
          {!isAuthenticated && (
            <Link
              href="/login"
              onClick={() => setMenuOpen(false)}
              className="block rounded-[6px] px-3 py-2.5 text-[13px] text-mist transition-colors hover:bg-white/5 hover:text-paper sm:hidden"
            >
              Log in
            </Link>
          )}
        </nav>
      )}
    </header>
  )
}
