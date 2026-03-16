// Pre-flight search: find the anslagstavla URL before Discovery navigates.
// This fixes the subdomain problem (anslagstavla.helsingborg.se, motenmedborgarportal.malmo.se)
// by giving Sonnet the correct starting point.
//
// Uses Google search via Playwright (no API key needed).

import { chromium } from "playwright";

export async function preflight(municipalityName, browser) {
  const queries = [
    `${municipalityName} kommun anslagstavla bygglov`,
    `${municipalityName} kommun kungorelser bygglov`,
    `${municipalityName} bygglov beslut anslagstavla`,
  ];

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  const foundUrls = new Set();

  for (const query of queries) {
    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=sv`;
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(1500);

      // Extract URLs from search results
      const urls = await page.evaluate(() => {
        const links = document.querySelectorAll("a[href]");
        const results = [];
        for (const link of links) {
          const href = link.getAttribute("href");
          // Google wraps results in /url?q= or direct links
          if (href && href.startsWith("http") && !href.includes("google.com") && !href.includes("youtube.com")) {
            results.push(href);
          }
          // Handle Google's /url?q= format
          if (href && href.startsWith("/url?q=")) {
            const match = href.match(/\/url\?q=([^&]+)/);
            if (match) {
              const decoded = decodeURIComponent(match[1]);
              if (!decoded.includes("google.com")) {
                results.push(decoded);
              }
            }
          }
        }
        return results;
      });

      urls.forEach((u) => foundUrls.add(u));
    } catch (err) {
      console.log(`  [Preflight] Search failed for "${query}": ${err.message}`);
    }

    // Rate limit between searches
    await new Promise((r) => setTimeout(r, 2000));
  }

  await context.close();

  // Score and rank URLs — prefer those with keywords like anslagstavla, bygglov, kungorelse
  const scored = [...foundUrls].map((url) => {
    let score = 0;
    const lower = url.toLowerCase();
    if (lower.includes("anslagstavla")) score += 10;
    if (lower.includes("kungorelse")) score += 8;
    if (lower.includes("bygglov")) score += 5;
    if (lower.includes("bygga")) score += 3;
    if (lower.includes("beslut")) score += 2;
    // Penalize non-relevant pages
    if (lower.includes("pdf")) score -= 3;
    if (lower.includes("blankett")) score -= 5;
    if (lower.includes("taxa")) score -= 5;
    if (lower.includes("facebook.com")) score -= 10;
    if (lower.includes("linkedin.com")) score -= 10;
    return { url, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const topUrls = scored.slice(0, 5);

  console.log(`  [Preflight] Found ${foundUrls.size} URLs, top ${topUrls.length}:`);
  topUrls.forEach((u) => console.log(`    ${u.score}p: ${u.url}`));

  return {
    all_urls: [...foundUrls],
    ranked_urls: topUrls,
    best_guess: topUrls.length > 0 ? topUrls[0].url : null
  };
}
