import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import dynamic from "next/dynamic";

const title = "Create an account";
const description = "Enter your details to get started.";
const SignUp = dynamic(() =>
  import("@repo/auth/components/sign-up").then((mod) => mod.SignUp)
);

export const metadata: Metadata = {
  ...createMetadata({ title, description }),
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

const SignUpPage = () => <SignUp />;

export default SignUpPage;
