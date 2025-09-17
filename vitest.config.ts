import { defineConfig } from "vitest/config";

const coverageEnabled = process.env.VITEST_COVERAGE === "true";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      enabled: coverageEnabled,
      provider: "istanbul",
      include: ["./src/**/*.{ts,tsx,js}"],
      extension: [".ts", ".js"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/drizzle.config.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 100,
        statements: 90,
      },
    },
  },
});
