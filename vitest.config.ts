import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Vitest runs the server-side helpers (validation logic, services) in a Node
// environment. The "@/..." path alias mirrors tsconfig so imports resolve the
// same way they do under Next.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
})
