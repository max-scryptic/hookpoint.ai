"use client"

import { useState } from "react"
import { ArrowDownIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const SOURCE_FILE_SECTION_ID = "source-file-upload"

export function SourceFilePrompt() {
  const [isVisible, setIsVisible] = useState(true)

  if (!isVisible) return null

  function scrollToUpload() {
    const uploadSection = document.getElementById(SOURCE_FILE_SECTION_ID)
    uploadSection?.scrollIntoView({ behavior: "smooth", block: "start" })
    uploadSection?.focus({ preventScroll: true })
  }

  return (
    <Card className="w-full sm:ml-auto sm:max-w-sm" size="sm">
      <CardHeader>
        <CardTitle>Want deeper insights?</CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss source file prompt"
            onClick={() => setIsVisible(false)}
          >
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">
          Upload your source file below.
        </p>
        <Button size="sm" onClick={scrollToUpload}>
          Upload source file
          <ArrowDownIcon data-icon="inline-end" />
        </Button>
      </CardContent>
    </Card>
  )
}
