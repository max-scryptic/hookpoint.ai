"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { CheckCircle2Icon, XIcon } from "lucide-react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { AppNotification } from "@/lib/notifications"

const POLL_INTERVAL_MS = 5000

export function NotificationAlerts() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications?unread=true", {
        cache: "no-store",
      })
      if (response.ok) {
        const data = (await response.json()) as { notifications: AppNotification[] }
        setNotifications(data.notifications)
      }
    } finally {
      if (mountedRef.current) {
        timerRef.current = setTimeout(() => void poll(), POLL_INTERVAL_MS)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void poll()
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [poll])

  async function dismiss(notificationId: string) {
    setNotifications((current) => current.filter(({ id }) => id !== notificationId))
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: notificationId }),
    }).catch(() => {})
  }

  if (notifications.length === 0) return null

  return (
    <aside
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3"
    >
      {notifications.map((notification) => (
        <Alert key={notification.id} className="pr-12 shadow-lg">
          <CheckCircle2Icon className="text-emerald-600 dark:text-emerald-500" />
          <AlertTitle>{notification.title}</AlertTitle>
          <AlertDescription>
            {notification.description}{" "}
            {notification.analysedVideoId ? (
              <Link
                href={`/dashboard/analysed-video/${notification.analysedVideoId}`}
                className="font-medium text-foreground underline underline-offset-4"
              >
                View analysis
              </Link>
            ) : null}
          </AlertDescription>
          <AlertAction>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss notification"
              onClick={() => void dismiss(notification.id)}
            >
              <XIcon />
            </Button>
          </AlertAction>
        </Alert>
      ))}
    </aside>
  )
}
