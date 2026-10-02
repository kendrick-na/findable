const { execSync, spawnSync } = require("node:child_process");

// Vercel Ignored Build Step. exit 0 = 이 배포를 건너뛴다 / exit 1 = 빌드한다.
//
// 🔴 왜 turbo-ignore 를 붙였나 (2026-09-09 실측)
//   원래 이 스크립트는 커밋 메시지의 `[skip ci]` 만 봤다(next-forge 기본값).
//   즉 **어떤 앱이 실제로 바뀌었는지는 전혀 보지 않아** main 에 push 할 때마다
//   findable · findable-app 이 **둘 다** 빌드됐다.
//   2026-09-08 실측: 70분 동안 main 커밋 6개 → 프로덕션 빌드 12개.
//   그중 web 만 건드린 커밋에도 app 이 빌드됐고, 그 app 빌드는 5번 연속 실패했다
//   (= 순수 낭비). 같은 주기 Build CPU 76시간 / $15.97 로 파인더블 인프라비의 92.5%.
//
//   `turbo-ignore` 는 turbo 의존성 그래프로 "이 앱 또는 그 의존 패키지가 바뀌었나"를
//   판정한다. Vercel 이 Turborepo 모노레포에 공식 권장하는 방식이다
//   (docs/monorepos/turborepo — Ignored Build Step: `npx turbo-ignore --fallback=HEAD^1`).
//
// ⚠️ 실패 방향은 **빌드하는 쪽**이다. turbo-ignore 가 네트워크 등으로 못 돌면
//   exit 1 로 떨어뜨려 그냥 빌드한다. "안 바뀐 걸 빌드"는 돈만 쓰지만
//   "바뀐 걸 안 빌드"는 배포 누락이라 훨씬 나쁘다.
const commitMessage = execSync("git log -1 --pretty=%B").toString().trim();

if (commitMessage.includes("[skip ci]")) {
  console.log("Skipping build due to [skip ci] in commit message.");
  process.exit(0); // this causes Vercel to skip the build
}

const result = spawnSync(
  "npx",
  ["--yes", "turbo-ignore", "--fallback=HEAD^1"],
  { stdio: "inherit" },
);

if (result.status === 0) {
  console.log("Skipping build: turbo-ignore found no changes for this app.");
  process.exit(0);
}

process.exit(1); // continue with build
