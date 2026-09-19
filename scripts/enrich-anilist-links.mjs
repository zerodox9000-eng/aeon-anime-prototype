import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const inputPath = path.resolve(process.env.INPUT_PATH ?? "./data/anime-anilist-prototype-final.json");
const batchSize = Number(process.env.LINK_BATCH_SIZE ?? 50);
const delayMs = Number(process.env.ANILIST_LINK_DELAY_MS ?? 900);
const snapshot = JSON.parse(await fs.readFile(inputPath, "utf8"));
const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
const query = `
query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(type: ANIME, id_in: $ids) {
      id
      externalLinks { url site type language isDisabled }
    }
  }
}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const linksById = new Map();

async function request(ids) {
  let attempt = 0;
  while (true) {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, variables: { ids } }),
    });
    const bodyText = await response.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error(`AniList link response was not JSON (${response.status}).`);
    }
    if (response.status === 429 || body.errors?.some((error) => error.status === 429)) {
      attempt += 1;
      if (attempt > 6) throw new Error("AniList link requests remained rate limited after six retries.");
      const retryAfter = Number(response.headers.get("retry-after") ?? 30);
      console.log(`Link request rate limited. Waiting ${retryAfter}s before retry ${attempt}/6.`);
      await sleep(Math.max(retryAfter * 1000, delayMs));
      continue;
    }
    if (!response.ok || body.errors?.length) {
      throw new Error(`AniList link query failed (${response.status}): ${JSON.stringify(body.errors ?? body).slice(0, 800)}`);
    }
    for (const media of body.data?.Page?.media ?? []) {
      const links = (media.externalLinks ?? [])
        .filter((link) => !link.isDisabled && typeof link.url === "string" && link.url.trim())
        .map((link) => ({
          url: link.url.trim(),
          site: link.site ?? null,
          type: link.type ?? null,
          language: link.language ?? null,
        }));
      linksById.set(media.id, links);
    }
    return;
  }
}

for (let index = 0; index < rows.length; index += batchSize) {
  const ids = rows.slice(index, index + batchSize).map((row) => Number(row.anilistId)).filter(Number.isSafeInteger);
  await request(ids);
  console.log(`Fetched AniList links for ${Math.min(index + ids.length, rows.length)}/${rows.length}.`);
  if (index + batchSize < rows.length) await sleep(delayMs);
}

let streamingLinks = 0;
snapshot.rows = rows.map((row) => {
  const externalLinks = linksById.get(Number(row.anilistId)) ?? [];
  streamingLinks += externalLinks.filter((link) => link.type === "STREAMING").length;
  return { ...row, externalLinks };
});
snapshot.externalLinkPolicy = "AniList externalLinks are preserved; the frontend displays only non-disabled STREAMING links as watching links.";
snapshot.externalLinkEnrichment = {
  fetchedAt: new Date().toISOString(),
  rows: rows.length,
  streamingLinks,
};
await fs.writeFile(inputPath, JSON.stringify(snapshot, null, 2));
console.log(JSON.stringify({ inputPath, rows: rows.length, streamingLinks }, null, 2));
