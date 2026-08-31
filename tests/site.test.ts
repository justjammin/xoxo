import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import siteWorker from "../worker/site";

const request = (path: string, method = "GET") => new Request(`https://xoxo.example${path}`, { method });

describe("Cloudflare site and AI discovery", () => {
  test("serves search crawlers while separating model-training crawlers", async () => {
    const response = await siteWorker.fetch(request("/robots.txt"), { ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } });
    const body = await response.text();
    expect(body).toContain("User-agent: OAI-SearchBot\nAllow: /");
    expect(body).toContain("User-agent: Claude-SearchBot\nAllow: /");
    expect(body).toContain("User-agent: PerplexityBot\nAllow: /");
    expect(body).toContain("User-agent: GPTBot\nDisallow: /");
    expect(body).toContain("Sitemap: https://xoxo.example/sitemap.xml");
  });

  test("publishes canonical sitemap and LLM summaries", async () => {
    const env = { ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } };
    const sitemap = await (await siteWorker.fetch(request("/sitemap.xml"), env)).text();
    const llms = await (await siteWorker.fetch(request("/llms.txt"), env)).text();
    expect(sitemap).toContain("<loc>https://xoxo.example/</loc>");
    expect(llms).toContain("# XOXO");
    expect(llms).toContain("XOXO compares headless Claude Code and Codex");
    expect(llms).toContain("https://xoxo.example/llms-full.txt");
  });

  test("rewrites canonical metadata to the deployed origin and adds security headers", async () => {
    const env = { ASSETS: { fetch: async () => new Response('<link rel="canonical" href="https://xoxo.invalid/">', { headers: { "content-type": "text/html" } }) } };
    const response = await siteWorker.fetch(request("/"), env);
    expect(await response.text()).toContain('href="https://xoxo.example/"');
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  test("keeps structured answers valid and visible", async () => {
    const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const schema = JSON.parse(match![1]!) as { "@graph": Array<{ "@type": string; mainEntity?: Array<{ name: string }> }> };
    const faq = schema["@graph"].find((item) => item["@type"] === "FAQPage");
    expect(faq?.mainEntity?.length).toBe(5);
    for (const item of faq?.mainEntity ?? []) expect(html).toContain(item.name);
  });
});
