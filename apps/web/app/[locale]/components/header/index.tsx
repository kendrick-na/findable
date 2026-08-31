"use client";

import { ModeToggle } from "@repo/design-system/components/mode-toggle";
import { Button } from "@repo/design-system/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@repo/design-system/components/ui/navigation-menu";
import type { Dictionary } from "@repo/internationalization";
import { Menu, MoveRight, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { env } from "@/env";
import { LanguageSwitcher } from "./language-switcher";

interface HeaderProps {
  dictionary: Dictionary;
}

export const Header = ({ dictionary }: HeaderProps) => {
  const navigationItems = [
    {
      title: dictionary.web.header.home,
      href: "/",
      description: "",
    },
    {
      title: dictionary.web.header.product.title,
      description: dictionary.web.header.product.description,
      items: [
        {
          title: dictionary.web.header.product.pricing,
          href: "/pricing",
        },
      ],
    },
    {
      title: dictionary.web.header.blog,
      href: "/insights",
      description: "",
    },
    {
      title: dictionary.web.header.knowledge,
      href: "/glossary",
      description: "",
    },
  ];

  if (env.NEXT_PUBLIC_DOCS_URL) {
    navigationItems.push({
      title: dictionary.web.header.docs,
      href: env.NEXT_PUBLIC_DOCS_URL,
      description: "",
    });
  }

  const [isOpen, setOpen] = useState(false);
  return (
    <header className="sticky top-0 left-0 z-40 w-full border-[var(--findable-hairline)] border-b bg-[var(--findable-canvas)]">
      <div className="container relative mx-auto flex min-h-20 flex-row items-center gap-4 lg:grid lg:grid-cols-3">
        <div className="hidden flex-row items-center justify-start gap-4 lg:flex">
          <NavigationMenu className="flex items-start justify-start">
            <NavigationMenuList className="flex flex-row justify-start gap-4">
              {navigationItems.map((item) => (
                <NavigationMenuItem key={item.title}>
                  {item.href ? (
                    <NavigationMenuLink asChild>
                      <Button asChild variant="ghost">
                        <Link href={item.href}>{item.title}</Link>
                      </Button>
                    </NavigationMenuLink>
                  ) : (
                    <>
                      <NavigationMenuTrigger className="font-medium text-sm">
                        {item.title}
                      </NavigationMenuTrigger>
                      <NavigationMenuContent className="!w-[450px] p-4">
                        <div className="flex grid-cols-2 flex-col gap-4 lg:grid">
                          <div className="flex h-full flex-col justify-between">
                            <div className="flex flex-col">
                              <p className="text-base">{item.title}</p>
                              <p className="text-muted-foreground text-sm">
                                {item.description}
                              </p>
                            </div>
                            <Button asChild className="mt-10" size="sm">
                              <Link href="/contact">
                                {dictionary.web.global.primaryCta}
                              </Link>
                            </Button>
                          </div>
                          <div className="flex h-full flex-col justify-end text-sm">
                            {item.items?.map((subItem) => (
                              <NavigationMenuLink
                                className="flex flex-row items-center justify-between rounded px-4 py-2 hover:bg-muted"
                                href={subItem.href}
                                key={subItem.href}
                              >
                                <span>{subItem.title}</span>
                                <MoveRight className="h-4 w-4 text-muted-foreground" />
                              </NavigationMenuLink>
                            ))}
                          </div>
                        </div>
                      </NavigationMenuContent>
                    </>
                  )}
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>
        </div>
        {/* shrink-0 — 200% 확대(195px)에서 워드마크가 34px 로 짓눌려 글자가
            삐져나갔다(WCAG 1.4.10). 로고는 줄지 않고 오른쪽 묶음이 줄어야 한다. */}
        <div className="flex shrink-0 items-baseline lg:justify-center">
          <span
            className="whitespace-nowrap text-[22px] text-[var(--findable-ink)] leading-none"
            style={{
              fontFamily: "var(--findable-font-wordmark)",
              letterSpacing: "-0.01em",
            }}
          >
            Findable
          </span>
          <span className="ml-[5px] inline-block h-[5px] w-[5px] bg-[var(--findable-primary)]" />
        </div>
        <div className="flex w-full min-w-0 justify-end gap-4">
          <Button asChild className="hidden md:inline" variant="ghost">
            <Link href="/contact">{dictionary.web.header.contact}</Link>
          </Button>
          <div className="hidden border-r md:inline" />
          <div className="hidden md:inline">
            <LanguageSwitcher />
          </div>
          <div className="hidden md:inline">
            <ModeToggle />
          </div>
          <Button asChild className="hidden md:inline" variant="outline">
            <Link href={`${env.NEXT_PUBLIC_APP_URL}/sign-in`}>
              {dictionary.web.header.signIn}
            </Link>
          </Button>
          <Button asChild>
            <Link href={`${env.NEXT_PUBLIC_APP_URL}/sign-up`}>
              {dictionary.web.header.signUp}
            </Link>
          </Button>
        </div>
        {/* shrink-0 — 언어·메뉴 버튼 2개(각 40px)가 들어갈 폭을 확보한다.
            없으면 부모가 50px 로 짓눌려 메뉴 버튼이 화면 밖(right=424)으로 나갔다. */}
        <div className="flex shrink-0 items-center gap-2 lg:hidden">
          <LanguageSwitcher />
          <Button
            aria-expanded={isOpen}
            aria-label={
              isOpen
                ? dictionary.web.header.closeMenu
                : dictionary.web.header.openMenu
            }
            onClick={() => setOpen(!isOpen)}
            variant="ghost"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          {isOpen && (
            <div className="container absolute top-20 right-0 flex w-full flex-col gap-8 border-[var(--findable-hairline)] border-t bg-[var(--findable-canvas)] py-4 shadow-lg">
              {navigationItems.map((item) => (
                <div key={item.title}>
                  <div className="flex flex-col gap-2">
                    {item.href ? (
                      <Link
                        className="flex items-center justify-between"
                        href={item.href}
                        rel={
                          item.href.startsWith("http")
                            ? "noopener noreferrer"
                            : undefined
                        }
                        target={
                          item.href.startsWith("http") ? "_blank" : undefined
                        }
                      >
                        <span className="text-lg">{item.title}</span>
                        <MoveRight className="h-4 w-4 stroke-1 text-muted-foreground" />
                      </Link>
                    ) : (
                      <p className="text-lg">{item.title}</p>
                    )}
                    {item.items?.map((subItem) => (
                      <Link
                        className="flex items-center justify-between"
                        href={subItem.href}
                        key={subItem.title}
                      >
                        <span className="text-muted-foreground">
                          {subItem.title}
                        </span>
                        <MoveRight className="h-4 w-4 stroke-1" />
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
