import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const inputPath = path.resolve(process.env.INPUT_PATH ?? "./data/anime-anilist-prototype-final.json");
const batchSize = Number(process.env.COVER_BATCH_SIZE ?? 50);
const delayMs = Number(process.env.ANILIST_COVER_DELAY_MS ?? 750);
const snapshot = JSON.parse(await fs.readFile(inputPath, "utf8"));
const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
const query = `
query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(type: ANIME, id_in: $ids) {
      id
      coverImage { extraLarge large medium color }
    }
  }
}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const covers = new Map();

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
      throw new Error(`AniList cover response was not JSON (${response.status}).`);
    }
    if (response.status === 429 || body.errors?.some((error) => error.status === 429)) {
      attempt += 1;
      if (attempt > 6) throw new Error("AniList cover requests remained rate limited after six retries.");
      const retryAfter = Number(response.headers.get("retry-after") ?? 30);
      console.log(`Cover request rate limited. Waiting ${retryAfter}s before retry ${attempt}/6.`);
      await sleep(Math.max(retryAfter * 1000, delayMs));
      continue;
    }
    if (!response.ok || body.errors?.length) {
      throw new Error(`AniList cover query failed (${response.status}): ${JSON.stringify(body.errors ?? body).slice(0, 800)}`);
    }
    for (const media of body.data?.Page?.media ?? []) {
      const url = media.coverImage?.extraLarge ?? media.coverImage?.large ?? media.coverImage?.medium ?? null;
      const color = typeof media.coverImage?.color === "string" ? media.coverImage.color : null;
      if (url || color) covers.set(media.id, { url, color });
    }
    return;
  }
}

for (let index = 0; index < rows.length; index += batchSize) {
  const ids = rows.slice(index, index + batchSize).map((row) => Number(row.anilistId)).filter(Number.isSafeInteger);
  await request(ids);
  console.log(`Fetched AniList covers for ${Math.min(index + ids.length, rows.length)}/${rows.length}.`);
  if (index + batchSize < rows.length) await sleep(delayMs);
}

let resolved = 0;
snapshot.rows = rows.map((row) => {
  const cover = covers.get(Number(row.anilistId)) ?? { url: null, color: null };
  if (cover.url) resolved += 1;
  return { ...row, coverImage: cover.url, coverColor: cover.color };
});
snapshot.coverPolicy = "AniList GraphQL Media.coverImage.extraLarge, with large/medium fallback; cover colors use AniList Media.coverImage.color; missing values remain null.";
snapshot.coverEnrichment = {
  fetchedAt: new Date().toISOString(),
  resolved,
  missing: rows.length - resolved,
  batchSize,
};
await fs.writeFile(inputPath, JSON.stringify(snapshot, null, 2));
console.log(JSON.stringify({ inputPath, rows: rows.length, resolved, missing: rows.length - resolved }, null, 2));
