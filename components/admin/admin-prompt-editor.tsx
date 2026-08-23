"use client"

import { useMemo, useState } from "react"
import { format, formatDistanceToNow } from "date-fns"
import {
  AlertTriangleIcon,
  HistoryIcon,
  RotateCcwIcon,
  UndoIcon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import type { AdminPromptDetail, PromptVersion } from "@/lib/admin/prompts"
import {
  PROMPT_GROUP_LABELS,
  PROMPT_ROLE_LABELS,
} from "@/lib/prompts/registry"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

// One prompt's editor and changelog. Saving appends a version and makes it live
// on the next call; reverting appends the older text as a new version rather
// than rewinding the history, so the record of what ran when stays intact.

type Action =
  | { kind: "save"; note: string }
  | { kind: "revert"; version: number }
  | { kind: "reset" }

function SourceMeta({ prompt }: { prompt: AdminPromptDetail }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
      <div>
        <dt className="text-xs text-muted-foreground">Pipeline</dt>
        <dd>{PROMPT_GROUP_LABELS[prompt.group]}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Sent as</dt>
        <dd>{PROMPT_ROLE_LABELS[prompt.role]}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Model</dt>
        <dd className="truncate font-mono text-xs">
          {prompt.modelEnvVar ?? "Not sent on its own"}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Sent from</dt>
        <dd className="truncate font-mono text-xs">{prompt.source}</dd>
      </div>
    </dl>
  )
}

function VersionRow({
  version,
  isLive,
  onRevert,
  busy,
}: {
  version: PromptVersion
  isLive: boolean
  onRevert: () => void
  busy: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const label =
    version.source === "reset"
      ? "Reset to the shipped default"
      : version.source === "revert"
        ? `Reverted to v${version.revertedFromVersion}`
        : "Edited"

  return (
    <li className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">v{version.version}</span>
          <span className="text-muted-foreground">{label}</span>
          {isLive ? (
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
              Live
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {version.content !== null ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? "Hide text" : "Show text"}
            </Button>
          ) : null}
          {isLive ? null : (
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={onRevert}
            >
              <UndoIcon />
              Restore
            </Button>
          )}
        </div>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {version.authorEmail ?? "Unknown admin"} ·{" "}
        <span title={format(new Date(version.createdAt), "PPpp")}>
          {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
        </span>
        {version.note && version.source === "edit" ? ` · ${version.note}` : null}
      </p>

      {expanded && version.content !== null ? (
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
          {version.content}
        </pre>
      ) : null}
    </li>
  )
}

export function AdminPromptEditor({ prompt }: { prompt: AdminPromptDetail }) {
  const router = useRouter()
  const [draft, setDraft] = useState(prompt.editableText)
  // router.refresh() re-renders the server page but keeps this component's
  // state, so after a revert or a reset the draft would still hold the text
  // that was live before it. Adopting the new server text during render is the
  // documented way to reset state on a prop change without an effect pass.
  const [lastServerText, setLastServerText] = useState(prompt.editableText)
  if (lastServerText !== prompt.editableText) {
    setLastServerText(prompt.editableText)
    setDraft(prompt.editableText)
  }
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingRevert, setPendingRevert] = useState<number | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const isDirty = draft !== prompt.editableText
  const matchesDefault = draft === prompt.defaultSource

  // What the model would actually be sent, fragments substituted. Only the
  // saved text can be previewed resolved, so an unsaved draft is shown with its
  // placeholders intact rather than pretending to know what they expand to.
  const resolvedPreview = useMemo(
    () => (isDirty ? draft : prompt.resolvedText),
    [isDirty, draft, prompt.resolvedText],
  )

  async function run(action: Action) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/prompts/${prompt.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action.kind === "save"
            ? { action: "save", content: draft, note: action.note }
            : action.kind === "revert"
              ? { action: "revert", version: action.version }
              : { action: "reset" },
        ),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }

      setNote("")
      setPendingRevert(null)
      setConfirmingReset(false)
      router.refresh()
    } catch {
      setError("Could not reach the server. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">
          {prompt.label}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {prompt.description}
        </p>
      </div>

      <div className="rounded-lg border p-4">
        <SourceMeta prompt={prompt} />
      </div>

      {prompt.quotedBy.length > 0 ? (
        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p>
            This is a shared fragment. Editing it changes{" "}
            {prompt.quotedBy.length} other{" "}
            {prompt.quotedBy.length === 1 ? "prompt" : "prompts"}:{" "}
            {prompt.quotedBy.map((other, index) => (
              <span key={other.key}>
                {index > 0 ? ", " : null}
                <Link
                  href={`/admin/prompts/${other.key}`}
                  className="underline underline-offset-2"
                >
                  {other.label}
                </Link>
              </span>
            ))}
            .
          </p>
        </div>
      ) : null}

      <Tabs defaultValue="edit" className="gap-4">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="resolved">As sent</TabsTrigger>
          <TabsTrigger value="default">Shipped default</TabsTrigger>
          <TabsTrigger value="history">
            <HistoryIcon />
            History ({prompt.versions.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="space-y-3">
          {prompt.fragments.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              This prompt quotes{" "}
              {prompt.fragments.map((fragment, index) => (
                <span key={fragment.key}>
                  {index > 0 ? ", " : null}
                  <Link
                    href={`/admin/prompts/${fragment.key}`}
                    className="underline underline-offset-2"
                  >
                    <code className="font-mono text-xs">
                      {`{{${fragment.key}}}`}
                    </code>
                  </Link>
                </span>
              ))}
              . Leave the placeholder in place to keep following that fragment;
              replacing it with text pins this prompt to a copy that later edits
              will not reach.
            </p>
          ) : null}

          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            className="min-h-96 font-mono text-xs leading-relaxed"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {draft.length.toLocaleString()} characters
              {matchesDefault ? " · identical to the shipped default" : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {prompt.isOverridden ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmingReset(true)}
                >
                  <RotateCcwIcon />
                  Reset to default
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={!isDirty || busy}
                onClick={() => setDraft(prompt.editableText)}
              >
                Discard changes
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <label
                htmlFor="prompt-note"
                className="text-xs text-muted-foreground"
              >
                What changed, and why (optional, shown in the history)
              </label>
              <Input
                id="prompt-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Tightened the hold instruction"
                className="mt-1"
              />
            </div>
            <Button
              disabled={!isDirty || busy}
              onClick={() => run({ kind: "save", note })}
            >
              {busy ? "Saving" : "Save and make live"}
            </Button>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground">
            A saved edit reaches calls made from then on. Runs already in flight
            keep the text they started with, and each server instance can hold a
            resolved prompt for up to 30 seconds before picking the change up.
          </p>
        </TabsContent>

        <TabsContent value="resolved">
          <p className="mb-2 text-sm text-muted-foreground">
            {isDirty
              ? "Your unsaved draft, with fragment placeholders left as written."
              : "The exact text the next call will send, with every fragment substituted."}
          </p>
          <pre
            className={cn(
              "max-h-[32rem] overflow-auto rounded-lg border bg-muted p-3 text-xs whitespace-pre-wrap",
            )}
          >
            {resolvedPreview}
          </pre>
        </TabsContent>

        <TabsContent value="default">
          <p className="mb-2 text-sm text-muted-foreground">
            The text this prompt ships with, from{" "}
            <code className="font-mono text-xs">{prompt.source}</code>. This is
            what a reset goes back to, and it moves with each deploy.
          </p>
          <pre className="max-h-[32rem] overflow-auto rounded-lg border bg-muted p-3 text-xs whitespace-pre-wrap">
            {prompt.defaultText}
          </pre>
        </TabsContent>

        <TabsContent value="history">
          {prompt.versions.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              This prompt has never been edited. It is running on the text it
              shipped with.
            </p>
          ) : (
            <ul className="space-y-2">
              {prompt.versions.map((version, index) => (
                <VersionRow
                  key={version.id}
                  version={version}
                  isLive={index === 0}
                  busy={busy}
                  onRevert={() => setPendingRevert(version.version)}
                />
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={pendingRevert !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevert(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore v{pendingRevert}?</DialogTitle>
            <DialogDescription>
              This saves that version&apos;s text as a new version and makes it
              live. Nothing in the history is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              }
            />
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                if (pendingRevert !== null) {
                  void run({ kind: "revert", version: pendingRevert })
                }
              }}
            >
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingReset} onOpenChange={setConfirmingReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset to the shipped default?</DialogTitle>
            <DialogDescription>
              This prompt goes back to following the text in the code, including
              any later change to it. The versions saved here are kept and can
              be restored.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              }
            />
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void run({ kind: "reset" })}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
