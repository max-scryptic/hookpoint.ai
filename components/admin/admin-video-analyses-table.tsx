import { format } from "date-fns"
import Link from "next/link"
import { ExternalLinkIcon } from "lucide-react"

import type { AdminVideoAnalysis } from "@/lib/admin/video-analysis"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function AdminVideoAnalysesTable({
  userId,
  videos,
}: {
  userId: string
  videos: AdminVideoAnalysis[]
}) {
  if (videos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        This user hasn&rsquo;t analysed any videos yet.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Video</TableHead>
            <TableHead className="text-right">Events generated</TableHead>
            <TableHead>Analysed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {videos.map((video) => (
            <TableRow key={video.id}>
              <TableCell className="max-w-[360px]">
                <div className="flex items-center gap-2">
                  {/* The title links to the admin video detail page, where the
                      full deep-analysis evidence (every synthesized event and
                      the raw signals behind it) can be reviewed. The external
                      icon still opens the source video on YouTube. */}
                  <Link
                    href={`/admin/users/${userId}/videos/${video.id}`}
                    className="min-w-0 font-medium hover:underline"
                  >
                    <span className="block truncate">{video.title}</span>
                  </Link>
                  <a
                    href={`https://www.youtube.com/watch?v=${video.videoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open on YouTube"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {video.eventCount > 0 ? (
                  video.eventCount.toLocaleString()
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {format(new Date(video.dateAnalysed), "d MMM yyyy, HH:mm")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
