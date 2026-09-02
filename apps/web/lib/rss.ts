/**
 * RSS 2.0 조립기 — 허브 피드(`/rss.xml`)와 퍼블리셔 피드가 같은 코드를 쓴다.
 *
 * 🔴 **왜 퍼블리셔 피드가 필요한가**(2026-09-02): 네이버 서치어드바이저는
 *   **RSS 제출**이 색인 경로 중 하나다(1차 리서치 §1-8). 그런데 피드가
 *   `Findable Insights` 하나뿐이라 고객사는 자기 글만 담긴 피드를 제출할 수단이 없었다.
 *   고객사 블로그를 파는 제품에서 이건 기능 공백이다.
 */

const XML_UNSAFE_RE = /[&<>"']/g;
const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(value: string): string {
  return value.replace(XML_UNSAFE_RE, (char) => XML_ENTITIES[char] ?? char);
}

export interface RssItem {
  description: string;
  link: string;
  publishedAt: Date | null;
  title: string;
}

export interface RssChannel {
  description: string;
  items: RssItem[];
  language: string;
  link: string;
  /** 이 피드 자신의 절대 URL — `atom:link rel="self"` 로 알린다(피드 리더·검증기 권장). */
  selfUrl: string;
  title: string;
}

export function buildRssXml(channel: RssChannel): string {
  const items = channel.items
    .map((item) =>
      [
        "    <item>",
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(item.link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(item.link)}</guid>`,
        `      <description>${escapeXml(item.description)}</description>`,
        item.publishedAt
          ? `      <pubDate>${item.publishedAt.toUTCString()}</pubDate>`
          : null,
        "    </item>",
      ]
        .filter((line) => line !== null)
        .join("\n")
    )
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(channel.title)}</title>`,
    `    <link>${escapeXml(channel.link)}</link>`,
    `    <description>${escapeXml(channel.description)}</description>`,
    `    <language>${escapeXml(channel.language)}</language>`,
    `    <atom:link href="${escapeXml(channel.selfUrl)}" rel="self" type="application/rss+xml" />`,
    items,
    "  </channel>",
    "</rss>",
  ].join("\n");
}

export const RSS_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
  "Content-Type": "application/rss+xml; charset=utf-8",
} as const;
