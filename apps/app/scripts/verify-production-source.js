const { execFileSync } = require("node:child_process");

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

try {
  const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const dirtyFiles = execFileSync(
    "git",
    ["-C", repositoryRoot, "status", "--porcelain"],
    { encoding: "utf8" }
  ).trim();
  if (dirtyFiles) {
    throw new Error(
      `Production deployment blocked: repository has uncommitted changes.\n${dirtyFiles}`
    );
  }
} catch (error) {
  if (error instanceof Error && error.message.includes("uncommitted changes")) {
    throw error;
  }
  // Git-connected Vercel builds do not include .git. Provenance was validated
  // above from Vercel's Git-triggered system variables.
}
