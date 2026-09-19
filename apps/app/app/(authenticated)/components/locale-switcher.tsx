"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const LocaleSwitcher = () => {
  const pathname = usePathname() || "/";
  const next = encodeURIComponent(pathname);

  return (
    <nav aria-label="Language" className="flex items-center gap-1 text-xs">
      <Link className="rounded px-1.5 py-1 text-muted-foreground hover:text-foreground" href={`/locale?locale=ko&next=${next}`}>
        KO
      </Link>
      <span aria-hidden="true" className="text-muted-foreground/50">/</span>
      <Link className="rounded px-1.5 py-1 text-muted-foreground hover:text-foreground" href={`/locale?locale=en&next=${next}`}>
        EN
      </Link>
    </nav>
  );
};
