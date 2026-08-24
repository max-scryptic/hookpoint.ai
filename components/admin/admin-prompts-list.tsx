"use client"

import { useMemo, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { PencilLineIcon, SearchIcon } from "lucide-react"
import Link from "next/link"

import type { AdminPromptSummary } from "@/lib/admin/prompts"
import {
  PROMPT_GROUPS,
  PROMPT_GROUP_DESCRIPTIONS,
  PROMPT_GROUP_LABELS,
  type PromptGroup,
} from "@/lib/prompts/registry"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// The prompt index, grouped by pipeline. Each row says whether the prompt is
// running on the shipped text or on an override, which is the one thing worth
// seeing at a glance: an override is a change that never went through a review.

function OverrideBadge({ prompt }: { prompt: AdminPromptSummary }) {
  if (!prompt.isOverridden) {
    return (
      <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        Default
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
      <PencilLineIcon className="size-3" />
      Edited (v{prompt.activeVersion})
    </span>
  )
}

function GroupTable({
  group,
  prompts,
}: {
  group: PromptGroup
  prompts: AdminPromptSummary[]
}) {
  if (prompts.length === 0) return null

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold">{PROMPT_GROUP_LABELS[group]}</h2>
        <p className="text-sm text-muted-foreground">
          {PROMPT_GROUP_DESCRIPTIONS[group]}
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table className="min-w-[48rem] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Prompt</TableHead>
              <TableHead className="w-32">State</TableHead>
              <TableHead className="w-24 text-right">Length</TableHead>
              <TableHead className="w-24 text-right">Versions</TableHead>
              <TableHead className="w-44">Last changed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prompts.map((prompt) => (
              <TableRow key={prompt.key}>
                <TableCell className="align-top whitespace-normal break-words">
                  <Link
                    href={`/admin/prompts/${prompt.key}`}
                    className="font-medium hover:underline"
                  >
                    {prompt.label}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {prompt.description}
                  </p>
                </TableCell>
                <TableCell className="align-top">
                  <OverrideBadge prompt={prompt} />
                </TableCell>
                <TableCell className="align-top text-right tabular-nums text-muted-foreground">
                  {prompt.length.toLocaleString()}
                </TableCell>
                <TableCell className="align-top text-right tabular-nums text-muted-foreground">
                  {prompt.versionCount}
                </TableCell>
                <TableCell className="align-top text-muted-foreground">
                  {prompt.lastEditedAt ? (
                    <span title={prompt.lastEditedBy ?? undefined}>
                      {formatDistanceToNow(new Date(prompt.lastEditedAt), {
                        addSuffix: true,
                      })}
                    </span>
                  ) : (
                    "Never"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

export function AdminPromptsList({
  prompts,
}: {
  prompts: AdminPromptSummary[]
}) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return prompts
    return prompts.filter((prompt) =>
      [prompt.label, prompt.description, prompt.key, prompt.source].some(
        (field) => field.toLowerCase().includes(needle),
      ),
    )
  }, [prompts, query])

  const overridden = prompts.filter((prompt) => prompt.isOverridden).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search prompts"
            className="pl-8"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {overridden === 0
            ? `${prompts.length} prompts, all running on the shipped text.`
            : `${overridden} of ${prompts.length} prompts are running on an edited version.`}
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No prompts match that search.
        </p>
      ) : (
        PROMPT_GROUPS.map((group) => (
          <GroupTable
            key={group}
            group={group}
            prompts={filtered.filter((prompt) => prompt.group === group)}
          />
        ))
      )}
    </div>
  )
}
