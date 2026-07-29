import { useEffect } from "react"

// Warns the user before they leave the page while `enabled` is true, covering
// both kinds of departure:
//
//  1. Hard unloads — a reload, closing the tab, or navigating to another site —
//     via `beforeunload`, which shows the browser's native confirmation prompt.
//  2. In-app (client-side) route changes — clicking a link that the Next.js
//     App Router handles without a full page load. `beforeunload` never fires
//     for these, so we intercept the anchor click ourselves and ask for
//     confirmation with `window.confirm`, aborting the navigation if declined.
//
// `window.confirm` is used (rather than a custom dialog) because both checks
// have to resolve synchronously inside the event handler to be able to cancel
// the navigation, and it mirrors the native prompt the `beforeunload` path
// already shows.
export function useNavigationGuard(enabled: boolean, message: string) {
  useEffect(() => {
    if (!enabled) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy browsers require returnValue to be set for the prompt to show.
      event.returnValue = ""
    }

    // Capture-phase click interceptor for in-app navigations. Runs before the
    // App Router's own click handler so a declined confirm can stop it.
    const handleClickCapture = (event: MouseEvent) => {
      // Respect modified clicks (open in new tab/window) and non-primary
      // buttons — those don't navigate the current page, so there's nothing to
      // warn about.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const anchor = (event.target as Element | null)?.closest("a")
      if (!anchor) return

      const href = anchor.getAttribute("href")
      // Ignore anchors that don't navigate away: no href, new-tab targets,
      // downloads, and in-page hash / non-http(s) (mailto:, tel:) links.
      if (
        !href ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        href.startsWith("#")
      ) {
        return
      }

      const destination = new URL(href, window.location.href)
      if (
        destination.protocol !== "http:" &&
        destination.protocol !== "https:"
      ) {
        return
      }
      // A link to the exact current URL doesn't take the user anywhere.
      if (destination.href === window.location.href) return

      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    document.addEventListener("click", handleClickCapture, true)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      document.removeEventListener("click", handleClickCapture, true)
    }
  }, [enabled, message])
}
