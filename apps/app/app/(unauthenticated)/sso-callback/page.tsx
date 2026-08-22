import dynamic from "next/dynamic";

/**
 * OAuth 리다이렉트 복귀 지점. 실제 콜백 처리는 @repo/auth 안에서(=@clerk/nextjs 의존성 보유).
 */
const SSOCallback = dynamic(() =>
  import("@repo/auth/components/sso-callback").then((mod) => mod.SSOCallback)
);

const SSOCallbackPage = () => <SSOCallback />;

export default SSOCallbackPage;
