// 사용(권한자, 값 비노출):
//   bun prisma/check-db-targets.ts \
//     web.runtime=/tmp/web.env#FINDABLE_DATABASE_URL web.migrate=/tmp/web.env#DATABASE_URL_UNPOOLED \
//     app.runtime=/tmp/app.env#DATABASE_URL app.migrate=/tmp/app.env#DATABASE_URL_UNPOOLED
//   네트워크 접속 없음. 해시 지문·pooled 여부·그룹만 출력하고, 전부 같은 대상일 때만 exit 0.
//   ⚠️ env 파일은 현재 설정이다. 배포 시점 스냅샷과 다를 수 있다(W0-0 env 주입 한계).

import {
  compareDatabaseTargets,
  parseTargetSpec,
  safeErrorLabel,
} from "./db-target-fingerprint";

const specs = process.argv.slice(2);
if (specs.length < 2) {
  process.stderr.write(
    "[check-db-targets] need at least two <label>=<env-file>#<VAR> specs\n"
  );
  process.exitCode = 2;
} else {
  try {
    const named: Record<string, string | undefined> = {};
    for (const spec of specs) {
      const { label, value } = parseTargetSpec(spec);
      named[label] = value;
    }
    const verdict = compareDatabaseTargets(named);
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
    process.exitCode = verdict.allSameTarget ? 0 : 1;
  } catch (error: unknown) {
    process.stderr.write(
      `[check-db-targets] failed: ${safeErrorLabel(error)}\n`
    );
    process.exitCode = 2;
  }
}
