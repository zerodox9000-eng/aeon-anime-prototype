import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const API_URL = "https://graphql.anilist.co";
const inputPath = path.resolve(process.env.INPUT_PATH ?? "./data/anime-anilist-prototype-final.json");
const batchSize = Number(process.env.STAFF_BATCH_SIZE ?? 50);
const delayMs = Number(process.env.ANILIST_STAFF_DELAY_MS ?? 900);
const snapshot = JSON.parse(await fs.readFile(inputPath, "utf8"));
const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];

const CREATOR_ROLE_PATTERNS = [
  /\boriginal\s+(creator|story|work|concept|plan|draft)\b/i,
  /\b(creator|author|manga|novel|light novel|story|screenplay|screenwriter|writer|script|series composition)\b/i,
];

const query = `
query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(type: ANIME, id_in: $ids) {
      id
      staff(sort: RELEVANCE) { edges { role node { name { full } } } }
    }
  }
}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const staffById = new Map();

function isCreatorRole(role) {
  return CREATOR_ROLE_PATTERNS.some((pattern) => pattern.test(role));
}

function normalizeCredits(media) {
  const credits = [];
  const seen = new Set();
  for (const edge of media?.staff?.edges ?? []) {
    const name = edge?.node?.name?.full?.trim();
    const role = edge?.role?.trim();
    if (!name || !role) continue;
    const key = `${name}|${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    credits.push({ name, role });
  }
  return credits;
}

async function request(ids) {
  let attempt = 0;
  while (true) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, variables: { ids } }),
    });
    const bodyText = await response.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error(`AniList staff response was not JSON (${response.status}).`);
    }
    if (response.status === 429 || body.errors?.some((error) => error.status === 429)) {
      attempt += 1;
      if (attempt > 6) throw new Error("AniList staff requests remained rate limited after six retries.");
      const retryAfter = Number(response.headers.get("retry-after") ?? 30);
      console.log(`Staff request rate limited. Waiting ${retryAfter}s before retry ${attempt}/6.`);
      await sleep(Math.max(retryAfter * 1000, delayMs));
      continue;
    }
    if (!response.ok || body.errors?.length) {
      throw new Error(`AniList staff query failed (${response.status}): ${JSON.stringify(body.errors ?? body).slice(0, 800)}`);
    }
    for (const media of body.data?.Page?.media ?? []) {
      const staffCredits = normalizeCredits(media);
      const creatorCredits = staffCredits.filter((credit) => isCreatorRole(credit.role));
      staffById.set(media.id, {
        staffCredits,
        creatorCredits,
        creatorNames: [...new Set(creatorCredits.map((credit) => credit.name))],
      });
    }
    return;
  }
}

for (let index = 0; index < rows.length; index += batchSize) {
  const ids = rows.slice(index, index + batchSize).map((row) => Number(row.anilistId)).filter(Number.isSafeInteger);
  await request(ids);
  console.log(`Fetched AniList staff for ${Math.min(index + ids.length, rows.length)}/${rows.length}.`);
  if (index + batchSize < rows.length) await sleep(delayMs);
}

let rowsWithCreator = 0;
let rowsWithStaff = 0;
snapshot.rows = rows.map((row) => {
  const staff = staffById.get(Number(row.anilistId)) ?? { staffCredits: [], creatorCredits: [], creatorNames: [] };
  if (staff.staffCredits.length > 0) rowsWithStaff += 1;
  if (staff.creatorNames.length > 0) rowsWithCreator += 1;
  return { ...row, ...staff };
});
snapshot.staffPolicy = "AniList GraphQL Media.staff(sort: RELEVANCE) is preserved as staffCredits. Creator names use only explicit creator, author, original-work, story, writing, script, or series-composition roles; directors and other staff are not silently relabeled as creators.";
snapshot.staffEnrichment = {
  fetchedAt: new Date().toISOString(),
  rows: rows.length,
  rowsWithStaff,
  rowsWithCreator,
  missingCreator: rows.length - rowsWithCreator,
  batchSize,
};
await fs.writeFile(inputPath, JSON.stringify(snapshot, null, 2));
console.log(JSON.stringify({ inputPath, rows: rows.length, rowsWithStaff, rowsWithCreator, missingCreator: rows.length - rowsWithCreator }, null, 2));
