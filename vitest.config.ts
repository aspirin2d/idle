import { defineConfig } from "vitest/config";

const coverageEnabled = process.env.VITEST_COVERAGE === "true";

export default defineConfig({
  test: {
    threads: false,
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      enabled: coverageEnabled,
      provider: "istanbul",
      include: ["**/*.{ts,tsx,js}"],
      extension: [".ts", ".tsx", ".js"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/drizzle.config.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
