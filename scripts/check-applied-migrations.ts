// Fails when a migration committed to supabase/migrations has not been applied
// to the database.
//
// Nothing in the deploy pipeline runs migrations: Vercel ships the code the
// moment a pull request lands, and the SQL beside it is applied out of band by
// hand. So a merge can leave the application asking for a table or column the
// database does not have, and the failure is usually silent - the reads that
// touch new schema tend to be best-effort, so the feature simply never appears
// and nobody is told why. This is the thing that tells us.
//
// It runs after a push to main and again on a daily schedule, so a migration
// applied a few minutes after the merge turns the check green on its own.
// Deliberately not run on pull requests: a branch that adds a migration has not
// had it applied yet, which is correct rather than broken.
//
// Matching is by migration *name* - the filename with its leading timestamp and
// .sql suffix removed - not by the version stamp. The two do not line up here:
// a migration applied through the dashboard or the Supabase MCP is recorded
// under the timestamp of the moment it ran, not the one in the filename, so
// comparing versions would report almost every row as drift. Names survive
// that; renaming a committed migration is what breaks it, so don't.
//
// The reverse direction - a name in the ledger with no file in the repo - is
// left alone. Several of those exist and are expected: a follow-up fix applied
// straight to the database and then folded into the original migration file
// keeps its own ledger row forever, and flagging those would mean six lines of
// noise on every run for nothing anyone can act on.

import { execFileSync } from "node:child_process"
import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const MIGRATIONS_DIR = "supabase/migrations"

// The ledger the Supabase CLI, the dashboard's SQL editor and the management
// API all write to when they apply a migration.
const APPLIED_NAMES_QUERY =
  "select name from supabase_migrations.schema_migrations where name is not null"

// "20260821120000_create_onboarding_hints.sql" -> "create_onboarding_hints",
// which is what the ledger stores in its name column.
export function migrationNameFromFile(filename: string): string {
  return path.basename(filename, ".sql").replace(/^\d+_/, "")
}

// The committed migrations the database has no record of, in the order they
// would be applied. Filenames rather than names, since a filename is what
// someone has to go and open.
export function unappliedMigrationFiles(
  migrationFiles: string[],
  appliedNames: Iterable<string>,
): string[] {
  const applied = new Set(appliedNames)
  return [...migrationFiles]
    .sort()
    .filter((file) => !applied.has(migrationNameFromFile(file)))
}

function readMigrationFiles(directory: string): string[] {
  return readdirSync(directory).filter((file) => file.endsWith(".sql"))
}

// psql's connection details go through the environment rather than argv, so a
// connection string carrying a password never reaches a CI log - not through
// the process listing, and not through the "Command failed: psql …" message
// Node builds when the child exits non-zero.
function connectionEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl)
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, "") || "postgres",
    // Supabase requires TLS, and the pooler presents a certificate this check
    // has no reason to pin: it reads one table of migration names.
    PGSSLMODE: url.searchParams.get("sslmode") ?? "require",
    PGCONNECT_TIMEOUT: "15",
  }
}

function readAppliedNames(databaseUrl: string): string[] {
  let output: string
  try {
    output = execFileSync(
      "psql",
      ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", APPLIED_NAMES_QUERY],
      // Captured rather than inherited, so psql's own complaint is reported
      // once, by the throw below, instead of twice.
      {
        encoding: "utf8",
        env: connectionEnv(databaseUrl),
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
  } catch (error) {
    // Never the error itself: its message repeats the command line.
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : ""
    throw new Error(`Could not read the migration ledger.\n${stderr}`)
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
}

function main(): void {
  const databaseUrl = process.env.SUPABASE_DB_URL
  if (!databaseUrl) {
    console.error(
      "SUPABASE_DB_URL is not set. It is the session-pooler connection string " +
        "from Supabase → Project Settings → Database, and in CI it comes from " +
        "the repository secret of the same name.",
    )
    process.exit(1)
  }

  const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../..")
  const directory = path.join(repoRoot, MIGRATIONS_DIR)
  const migrationFiles = readMigrationFiles(directory)

  let unapplied: string[]
  try {
    unapplied = unappliedMigrationFiles(
      migrationFiles,
      readAppliedNames(databaseUrl),
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  if (unapplied.length === 0) {
    console.log(
      `All ${migrationFiles.length} committed migrations are applied.`,
    )
    return
  }

  for (const file of unapplied) {
    // An annotation, so the run summary names the file rather than making
    // someone open the log to find out which one.
    console.log(
      `::error file=${MIGRATIONS_DIR}/${file}::Committed but not applied to the database`,
    )
  }
  console.error(
    `\n${unapplied.length} committed migration(s) have not been applied:\n` +
      unapplied.map((file) => `  ${MIGRATIONS_DIR}/${file}`).join("\n") +
      "\n\nWhatever shipped alongside them is live against a database that does " +
      "not have their schema yet. Apply them - the dashboard's SQL editor, or " +
      "supabase db push - and re-run this check.",
  )
  process.exit(1)
}

// Only when run as a script: the tests import the two pure functions above.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
