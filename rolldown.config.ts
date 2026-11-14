import { defineConfig } from "rolldown";

import { cssInline } from "./build/css-inline.ts";
import { versionDefine } from "./build/version.ts";

export default defineConfig({
  input: "src/index.ts",
  output: { file: "dist/smart-plug-card.js", format: "es", minify: true },
  transform: { define: versionDefine() },
  plugins: [cssInline()],
});
