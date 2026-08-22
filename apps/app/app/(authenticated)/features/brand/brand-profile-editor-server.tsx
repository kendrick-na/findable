import { updateBrandProfile } from "@/app/actions/brand/update-profile";
import { getAppDictionary } from "@/lib/i18n";
import { BrandProfileEditor } from "./brand-profile-editor";

/**
 * 별칭·경쟁사 편집 **서버 껍데기** — 서버액션을 먹고 순수 뷰에 넘긴다.
 *
 * 🔴 뷰가 `@/app/actions/...` 를 직접 import 하면 Prisma·`server-only` 가 브라우저
 *   번들에 딸려와 **Storybook 이 통째로 죽는다**(N-44 실측 · `node:fs` UnhandledScheme).
 *   📕 N-37·N-41 주입 패턴.
 *
 * ⚠️ `Json` 컬럼이라 모양이 열려 있다 — 화면에 넘기기 전에 **문자열 배열로 좁힌다**.
 *   안 좁히면 `[object Object]` 가 칩으로 렌더된다.
 */
const toNameList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      out.push(item);
    } else if (item && typeof item === "object" && "name" in item) {
      const name = (item as { name?: unknown }).name;
      if (typeof name === "string" && name.length > 0) {
        out.push(name);
      }
    }
  }
  return out;
};

export const BrandProfileEditorServer = async ({
  brandId,
  competitors,
  entityVariants,
}: {
  brandId: string;
  competitors: unknown;
  entityVariants: unknown;
}) => {
  // 🔴 사전은 서버에서만 읽는다(`server-only`) — 뷰에는 문자열만 내려간다.
  const t = (await getAppDictionary()).onboarding;
  return (
    <BrandProfileEditor
      brandId={brandId}
      competitors={toNameList(competitors)}
      entityVariants={toNameList(entityVariants)}
      onSave={updateBrandProfile}
      t={t}
    />
  );
};
