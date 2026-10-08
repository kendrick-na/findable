import { describe, expect, it } from "vitest";
import {
  isAllowedByRobots,
  medianPrice,
  parseRobotsDisallow,
  productFromPage,
  productsFromShopify,
  productUrlsFromSitemap,
} from "./brand-catalog";

// franzskincare.com robots.txt 일부(2026-10-05 실측). `User-agent: *` 묶음만 적용한다.
const ROBOTS = `User-agent: Yeti
Allow:/

User-agent: *
Disallow: /admin
Disallow: /skin-*/
Disallow: /*board*page=

User-agent: Googlebot
Disallow:
`;

describe("brand catalog — robots", () => {
  it("does not turn a wildcard rule into a site-wide block", () => {
    const disallow = parseRobotsDisallow(ROBOTS);
    expect(disallow).toEqual(["/admin", "/skin-*/", "/*board*page="]);
    expect(isAllowedByRobots("/product/abc/16/", disallow)).toBe(true);
    expect(isAllowedByRobots("/skin-skin1/x", disallow)).toBe(false);
    expect(isAllowedByRobots("/notice/board?page=2", disallow)).toBe(false);
    expect(isAllowedByRobots("/admin/login", disallow)).toBe(false);
  });
});

describe("brand catalog — sitemap and product pages", () => {
  it("keeps only same-host product URLs", () => {
    const xml = `<urlset><url><loc>https://franzskincare.com/product/a/16/</loc></url>
      <url><loc>https://franzskincare.com/board/notice/1/</loc></url>
      <url><loc>https://other.com/product/b/1/</loc></url></urlset>`;
    expect(productUrlsFromSitemap(xml, "franzskincare.com")).toEqual([
      "https://franzskincare.com/product/a/16/",
    ]);
  });

  it("reads the Cafe24 product name and price meta", () => {
    const html =
      '<meta property="og:title" content="프란츠 줄기세포배양액 10% 앰플" /><meta property="product:price:amount" content="10000" /><meta property="product:price:currency" content="KRW" />';
    expect(
      productFromPage(html, "https://franzskincare.com/product/a/16/")
    ).toEqual({
      name: "프란츠 줄기세포배양액 10% 앰플",
      price: 10_000,
      currency: "KRW",
      url: "https://franzskincare.com/product/a/16/",
    });
    expect(productFromPage("<title>no meta</title>", "https://x/")).toBeNull();
  });

  it("reads Shopify products.json", () => {
    expect(
      productsFromShopify(
        {
          products: [
            {
              title: "Blind Pimple Patches",
              handle: "blind",
              variants: [{ price: "10.00" }],
            },
            { handle: "untitled" },
          ],
        },
        "https://franzskincareusa.com"
      )
    ).toEqual([
      {
        name: "Blind Pimple Patches",
        price: 10,
        currency: null,
        url: "https://franzskincareusa.com/products/blind",
      },
    ]);
  });

  it("uses the median price per currency as the order value", () => {
    const p = (price: number) => ({
      name: "x",
      price,
      currency: "KRW",
      url: "u",
    });
    expect(medianPrice([p(10_000), p(40_000), p(30_000)], "KRW")).toBe(30_000);
    expect(medianPrice([p(10_000), p(30_000)], "KRW")).toBe(20_000);
    expect(medianPrice([], "KRW")).toBeNull();
  });
});
