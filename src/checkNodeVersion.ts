// Imported first by every entry point. On an older Node the project fails deep inside a dependency
// (for example "process.loadEnvFile is not a function"), so stop early with a clear message instead.
// 22.13 is the lowest version every dependency in package-lock.json supports (openai, vitest, eslint).
export const MIN_NODE_VERSION = "22.13.0";

export function isSupportedNodeVersion(version: string, minimum = MIN_NODE_VERSION): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [major = 0, minor = 0, patch = 0] = parse(version);
  const [minMajor = 0, minMinor = 0, minPatch = 0] = parse(minimum);
  if (major !== minMajor) return major > minMajor;
  if (minor !== minMinor) return minor > minMinor;
  return patch >= minPatch;
}

if (!isSupportedNodeVersion(process.versions.node)) {
  console.error(
    `\nThis project needs Node ${MIN_NODE_VERSION} or newer, but you are running ${process.version}.\n` +
      "Install Node 22 LTS or 24 LTS from https://nodejs.org, open a new terminal, then run:\n" +
      "  npm ci\n",
  );
  process.exit(1);
}
