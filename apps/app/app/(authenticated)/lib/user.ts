import type { currentUser } from "@repo/auth/server";

type ClerkUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

// Clerk 유저의 primary 이메일을 뽑는다. primaryEmailAddressId 우선,
// 없으면 첫 이메일로 폴백. AuditJob은 이메일 기준(organizationId 없음)이라 이 값이 조회 키.
export function getPrimaryEmail(user: ClerkUser): string | null {
  const primary = user.emailAddresses.find(
    (address) => address.id === user.primaryEmailAddressId
  );
  return primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
}
