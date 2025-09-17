import { defineConfig } from "vitest/config";

const coverageEnabled = process.env.VITEST_COVERAGE === "true";

export default defineConfig({
  test: {
    include: ["src/routes/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      enabled: coverageEnabled,
      provider: "v8",
      include: ["src/routes/**/*.{ts,tsx,js}"],
      extension: [".ts", ".js"],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "**/drizzle.config.ts",
        "src/routes/api.ts",
      ],
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
