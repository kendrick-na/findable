const { execFileSync } = require("node:child_process");

/**
 * A Vercel production deployment uploads the complete public app, not merely a
 * changed route. Block a local, uncommitted public-web state from reaching it.
 */
if (process.env.VERCEL_ENV !== "production") {
  process.exit(0);
}

if (!process.env.VERCEL_GIT_COMMIT_SHA) {
  throw new Error(
    "Production deployment requires a Git commit. Use the Git-connected release flow."
  );
}

let dirtyWebFiles;
try {
  const repositoryRoot = execFileSync(
    "git",
    ["rev-parse", "--show-toplevel"],
    { encoding: "utf8" }
  ).trim();
  dirtyWebFiles = execFileSync(
    "git",
    ["-C", repositoryRoot, "status", "--porcelain", "--", "apps/web"],
    { encoding: "utf8" }
  ).trim();
} catch {
  // Vercel's build container intentionally excludes `.git`. The platform has
  // already supplied the commit SHA above; local deployments are checked below
  // before upload by this same script.
  process.exit(0);
}

if (dirtyWebFiles) {
  throw new Error(
    `Production deployment blocked: apps/web has uncommitted changes.\n${dirtyWebFiles}`
  );
}
