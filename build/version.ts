import { readFileSync } from "node:fs";

/** `define` entry that puts the package.json version into the bundle as `__VERSION__`. */
export function versionDefine(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return { __VERSION__: JSON.stringify(pkg.version) };
}
