const { execFileSync } = require("node:child_process");

/**
 * A Vercel production deployment uploads the complete public app, not merely a
 * changed route. Block a local, uncommitted public-web state from reaching it.
 */
if (process.env.VERCEL_ENV !== "production") {
  process.exit(0);
}

if (
  process.env.VERCEL_GIT_PROVIDER !== "github" ||
  process.env.VERCEL_GIT_COMMIT_REF !== "main" ||
  !process.env.VERCEL_GIT_COMMIT_SHA
) {
  throw new Error(
    "Production deployment blocked: use the GitHub-connected main branch release flow."
  );
}

// Vercel prepares the checkout before the build (for example, it generates a
// project-level vercel.json and applies .vercelignore). Those platform changes
// are not source changes. Git provenance above is authoritative there; the
// working-tree check below is only for local runs.
if (process.env.VERCEL === "1") {
  process.exit(0);
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
    ["-C", repositoryRoot, "status", "--porcelain"],
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
    `Production deployment blocked: repository has uncommitted changes.\n${dirtyWebFiles}`
  );
}
