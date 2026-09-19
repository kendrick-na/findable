"use client";

import { Check, Copy, Facebook, Linkedin, Twitter } from "lucide-react";
import { useState } from "react";

export function ShareActions({ url, ko }: { url: string; ko: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const label = ko ? "이 글 공유하기" : "Share this article";

  return (
    <div aria-label={label} className="flex items-center gap-1.5">
      <a
        aria-label={ko ? "Facebook에 공유" : "Share on Facebook"}
        className="grid size-8 place-items-center rounded-full text-black/45 transition hover:bg-black/[0.06] hover:text-[#d95f38]"
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
        rel="noreferrer"
        target="_blank"
        title={ko ? "Facebook에 공유" : "Share on Facebook"}
      >
        <Facebook className="size-3.5" />
      </a>
      <a
        aria-label={ko ? "X에 공유" : "Share on X"}
        className="grid size-8 place-items-center rounded-full text-black/45 transition hover:bg-black/[0.06] hover:text-[#d95f38]"
        href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}`}
        rel="noreferrer"
        target="_blank"
        title={ko ? "X에 공유" : "Share on X"}
      >
        <Twitter className="size-3.5" />
      </a>
      <a
        aria-label={ko ? "LinkedIn에 공유" : "Share on LinkedIn"}
        className="grid size-8 place-items-center rounded-full text-black/45 transition hover:bg-black/[0.06] hover:text-[#d95f38]"
        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}
        rel="noreferrer"
        target="_blank"
        title={ko ? "LinkedIn에 공유" : "Share on LinkedIn"}
      >
        <Linkedin className="size-3.5" />
      </a>
      <button
        aria-label={copied ? (ko ? "링크가 복사됨" : "Link copied") : ko ? "링크 복사" : "Copy link"}
        className="grid size-8 place-items-center rounded-full text-black/45 transition hover:bg-black/[0.06] hover:text-[#d95f38]"
        onClick={copyLink}
        title={copied ? (ko ? "링크가 복사됨" : "Link copied") : ko ? "링크 복사" : "Copy link"}
        type="button"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
