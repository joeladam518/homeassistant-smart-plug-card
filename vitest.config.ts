import { defineConfig } from "vitest/config";

import { versionDefine } from "./build/version.ts";

export default defineConfig({
  define: versionDefine(),
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Process `?inline` CSS imports with postcss.config.js, as the build does.
    css: true,
  },
});
