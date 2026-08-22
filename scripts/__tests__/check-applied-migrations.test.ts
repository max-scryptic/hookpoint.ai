import { describe, expect, it } from "vitest"

import {
  migrationNameFromFile,
  unappliedMigrationFiles,
} from "@/scripts/check-applied-migrations"

describe("migration names", () => {
  it("strips the leading timestamp and the extension", () => {
    expect(
      migrationNameFromFile("20260821120000_create_onboarding_hints.sql"),
    ).toBe("create_onboarding_hints")
  })

  it("keeps digits that belong to the name itself", () => {
    expect(
      migrationNameFromFile("20260703184325_bucket_allow_mp3.sql"),
    ).toBe("bucket_allow_mp3")
  })
})

describe("unapplied migrations", () => {
  // The case this whole check exists for: the onboarding_hints table shipped
  // with its code and was never applied, so the coach marks it backs silently
  // never drew.
  it("reports a committed migration the ledger has never heard of", () => {
    expect(
      unappliedMigrationFiles(
        [
          "20260818120000_deep_analysis_autonomous_completion.sql",
          "20260821120000_create_onboarding_hints.sql",
        ],
        ["deep_analysis_autonomous_completion"],
      ),
    ).toEqual(["20260821120000_create_onboarding_hints.sql"])
  })

  it("passes when every committed migration has been applied", () => {
    expect(
      unappliedMigrationFiles(
        ["20260821120000_create_onboarding_hints.sql"],
        ["create_onboarding_hints", "harden_notification_privileges"],
      ),
    ).toEqual([])
  })

  // The version stamp a migration is recorded under is the moment it ran, not
  // the one in its filename, so only the name can be compared.
  it("matches on the name rather than the version stamp", () => {
    expect(
      unappliedMigrationFiles(
        ["20260704120000_add_analysis_proxy_to_source_files.sql"],
        ["add_analysis_proxy_to_source_files"],
      ),
    ).toEqual([])
  })

  // A row applied out of band and later folded into an existing migration file
  // keeps its ledger entry forever. That is expected here, not drift.
  it("ignores applied names that no longer have a file", () => {
    expect(
      unappliedMigrationFiles(
        ["20260712130000_create_notifications.sql"],
        [
          "create_notifications",
          "harden_notification_privileges",
          "index_notifications_analysed_video",
        ],
      ),
    ).toEqual([])
  })

  it("lists several in the order they would be applied", () => {
    expect(
      unappliedMigrationFiles(
        [
          "20260821120000_create_onboarding_hints.sql",
          "20260820120000_add_comparison_deep_credits_charged.sql",
        ],
        [],
      ),
    ).toEqual([
      "20260820120000_add_comparison_deep_credits_charged.sql",
      "20260821120000_create_onboarding_hints.sql",
    ])
  })
})
