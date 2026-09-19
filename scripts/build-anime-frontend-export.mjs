import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const repoRoot = path.resolve(process.env.REPO_ROOT ?? ".");
const inputPath = path.resolve(process.env.INPUT_PATH ?? path.join(repoRoot, "data", "anime-anilist-prototype-final.json"));
const outputRoot = path.resolve(process.env.OUTPUT_ROOT ?? path.join(repoRoot, "frontend", "public", "anime-data"));
const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
const rows = Array.isArray(raw.rows) ? raw.rows : [];
if (rows.length === 0) throw new Error("The anime snapshot has no rows.");

const generatedAt = raw.generatedAt ?? new Date().toISOString();
const contentHash = crypto.createHash("sha1")
  .update(JSON.stringify(rows))
  .digest("hex")
  .slice(0, 16);
const buildHash = crypto.createHash("sha1")
  .update(`aeon-anime|${generatedAt}|${rows.length}|${contentHash}|anilist-tags-v1`)
  .digest("hex")
  .slice(0, 16);
const buildId = `v1-${buildHash}`;
const buildRoot = path.join(outputRoot, "builds", buildId);

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outputRoot, "meta"), { recursive: true });
await fs.mkdir(buildRoot, { recursive: true });

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayFromCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function addUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

function categoryParts(category) {
  const parts = String(category ?? "Other").split("-").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : ["Other"];
}

const genreNames = [...new Set(rows.flatMap((row) => arrayFromCsv(row.genres)))].sort((left, right) => left.localeCompare(right));
const genreIds = new Map(genreNames.map((name, index) => [name, 2_000_000 + index]));
const tagMap = new Map();
for (const row of rows) {
  for (const tag of row.tagDetails ?? []) {
    if (!Number.isSafeInteger(tag.id) || !String(tag.name ?? "").trim()) continue;
    if (!tagMap.has(tag.id)) tagMap.set(tag.id, {
      id: tag.id,
      name: String(tag.name).trim(),
      category: tag.category ?? "Other",
    });
  }
}

const tags = [
  ...genreNames.map((name) => ({
    id: genreIds.get(name),
    name,
    path: `Genres > ${name}`,
    is_genre: true,
    parent_id: null,
    level: 1,
    source: "anilist",
    category: "Genre",
    anilist_category_model: "genres are separate from AniList MediaTag categories",
  })),
  ...[...tagMap.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((tag) => {
      const parts = categoryParts(tag.category);
      return {
        id: tag.id,
        name: tag.name,
        path: ["AniList", ...parts, tag.name].join(" > "),
        is_genre: false,
        parent_id: null,
        level: parts.length + 1,
        source: "anilist",
        category: tag.category,
        anilist_tag_id: tag.id,
        rank_semantics: "per-title relevance rank from AniList, not a probability and not a MangaBaka weight class",
      };
    }),
];

function titleEntries(row) {
  const entries = [];
  const seen = new Set();
  const add = (language, title, traits = [], isPrimary = false) => {
    const cleaned = String(title ?? "").trim();
    if (!cleaned || seen.has(`${language}|${cleaned}`)) return;
    seen.add(`${language}|${cleaned}`);
    entries.push({ language, title: cleaned, traits, is_primary: isPrimary });
  };
  add("en", row.titleEnglish, ["official"], Boolean(row.titleEnglish));
  add("x-user-preferred", row.titleUserPreferred);
  add("x-romaji", row.titleRomaji);
  add("x-native", row.titleNative);
  for (const synonym of String(row.titleSynonyms ?? "").split("|").map((item) => item.trim()).filter(Boolean)) {
    add("x-synonym", synonym, ["synonym"]);
  }
  return entries;
}

function rowTagIds(row) {
  const ids = arrayFromCsv(row.genres).flatMap((name) => {
    const id = genreIds.get(name);
    return id == null ? [] : [id];
  });
  for (const tag of row.tagDetails ?? []) {
    if (Number.isSafeInteger(tag.id)) addUnique(ids, tag.id);
  }
  return ids;
}

function contentRating(row) {
  if (row.hentaiStatus === "confirmed" || row.isAdult || row.hentaiHardFlag) return "pornographic";
  if (row.ecchiSignal) return "suggestive";
  return "safe";
}

function streamLanguageLabel(link) {
  const signal = `${link.site ?? ""} ${link.language ?? ""} ${link.url ?? ""}`.toLocaleLowerCase();
  if (/\b(dub|dubs|dubbed|english[-_ ]?dub)/.test(signal)) return "DUB";
  if (/\b(sub|subs|subbed|subtitle|subtitles)/.test(signal)) return "SUB";
  return null;
}

function creatorNames(row) {
  const credits = Array.isArray(row.creatorCredits)
    ? row.creatorCredits.flatMap((credit) => {
      const name = String(credit?.name ?? "").trim();
      const role = String(credit?.role ?? "").trim();
      return name && role ? [{ name, role }] : [];
    })
    : [];
  const roleBase = (role) => role.replace(/\s*\([^)]*\)\s*$/, "").trim().toLocaleLowerCase();
  const primaryRoles = new Set([
    "original creator",
    "original story",
    "original work",
    "original concept",
    "original plan",
    "original draft",
    "creator",
    "author",
    "manga",
    "novel",
    "light novel",
  ]);
  const primary = credits.filter((credit) => primaryRoles.has(roleBase(credit.role)));
  const secondary = credits.filter((credit) => /^(story|screenplay|screenwriter|writer|script|series composition|composition)\b/i.test(roleBase(credit.role)));
  const selected = primary.length > 0 ? primary : secondary;
  if (selected.length > 0) return [...new Set(selected.map((credit) => credit.name))];
  if (Array.isArray(row.creatorNames)) return [...new Set(row.creatorNames.map((name) => String(name ?? "").trim()).filter(Boolean))];
  return [];
}

function creatorCredits(row) {
  if (!Array.isArray(row.creatorCredits)) return [];
  return row.creatorCredits.flatMap((credit) => {
    const name = String(credit?.name ?? "").trim();
    const role = String(credit?.role ?? "").trim();
    return name && role ? [{ name, role }] : [];
  });
}

function watchingLinks(row) {
  return (row.externalLinks ?? [])
    .filter((link) => link && link.type === "STREAMING" && typeof link.url === "string" && link.url.trim())
    .map((link) => ({
      site: String(link.site ?? "Streaming service").trim() || "Streaming service",
      url: link.url.trim(),
      type: link.type ?? null,
      language: link.language ?? null,
      languageLabel: streamLanguageLabel(link),
    }))
    .filter((link, index, values) => values.findIndex((candidate) => candidate.url === link.url) === index);
}

function coverUrl(row) {
  // Covers come from AniList's Media.coverImage fields. Missing covers stay
  // null so the UI shows a clear placeholder instead of cropping a banner or
  // silently substituting an image from another service.
  return row.coverImage || null;
}

function catalogRecord(row) {
  const anilistId = Number(row.anilistId);
  const tagDetails = (row.tagDetails ?? []).filter((tag) => Number.isSafeInteger(tag.id));
  const startYear = Number(String(row.startDate ?? "").slice(0, 4));
  const analytics = {
    fanFavouriteRaw: numberOrNull(row.fanPercent),
    fanRatioPercentile: numberOrNull(row.fanRatioPercentile),
    popularityPercentile: numberOrNull(row.popularityPercentile),
    fanFavouriteDiscoveryScore: numberOrNull(row.discoveryScore),
    fanFavouriteDiscoveryPercentile: numberOrNull(row.fanRank),
    fanFavouriteWeighted: numberOrNull(row.discoveryScore),
    fanFavouritePercentile: numberOrNull(row.fanRatioPercentile),
  };
  return {
    id: anilistId,
    display_title: row.titleEnglish || row.titleDisplay || row.titleRomaji || `AniList ${anilistId}`,
    native_title: row.titleNative ?? null,
    romanized_title: row.titleRomaji ?? null,
    titles: titleEntries(row),
    cover: coverUrl(row),
    cover_color: row.coverColor ?? null,
    cover_source: row.coverImage ? "AniList Media.coverImage" : "Missing from AniList Media.coverImage",
    year: row.seasonYear ?? (Number.isFinite(startYear) ? startYear : null),
    status: row.status ?? null,
    content_rating: contentRating(row),
    type: row.format ?? "ANIME",
    total_chapters: row.episodes ?? null,
    tag_ids: rowTagIds(row),
    stats: {
      popularity: numberOrNull(row.popularity),
      favourites: numberOrNull(row.favourites),
      meanScore: numberOrNull(row.meanScore ?? row.averageScore),
    },
    analytics,
    published: {
      start_date: row.startDate ?? null,
      end_date: row.endDate ?? null,
      start_date_is_estimated: false,
      end_date_is_estimated: false,
    },
    first_seen_at: generatedAt,
    first_seen_at_is_trusted: true,
    created_at: generatedAt,
    added_at: generatedAt,
    last_updated_at: generatedAt,
    authors: creatorNames(row),
    artists: [],
    creator_credits: creatorCredits(row),
    creator_source: creatorCredits(row).length > 0 ? "AniList Media.staff" : "AniList Media.staff returned no creator-role credit",
    links: {
      ...(watchingLinks(row).length > 0 ? { watching: watchingLinks(row) } : {}),
    },
    source: {
      anilist: {
        id: anilistId,
        rating: numberOrNull(row.meanScore ?? row.averageScore),
        url: row.anilistUrl ?? `https://anilist.co/anime/${anilistId}`,
      },
    },
    description: row.description ?? null,
    // AniList-specific evidence intentionally stays separate from the shared
    // tag_weights field, which means something different in the manhwa app.
    anilist_genres: arrayFromCsv(row.genres),
    anilist_tag_model: "category-rank",
    anilist_tag_details: tagDetails.map((tag) => ({
      id: tag.id,
      name: tag.name,
      category: tag.category ?? null,
      rank: numberOrNull(tag.rank),
      isGeneralSpoiler: Boolean(tag.isGeneralSpoiler),
      isMediaSpoiler: Boolean(tag.isMediaSpoiler),
    })),
    anilist_tag_categories: [...new Set(tagDetails.map((tag) => tag.category).filter(Boolean))],
    content_filter_evidence: {
      blGlStatus: row.blGlStatus ?? null,
      blGlConfidence: row.blGlConfidence ?? null,
      blGlStrictExclude: Boolean(row.blGlStrictExclude),
      blGlNeedsReview: Boolean(row.blGlNeedsReview),
      hentaiStatus: row.hentaiStatus ?? null,
      ecchiSignal: Boolean(row.ecchiSignal),
    },
    english_dub: {
      status: row.englishDubStatus ?? "unknown",
      confidence: row.englishDubConfidence ?? "unknown",
      available: row.englishDubAvailable === true,
      sourceCount: numberOrNull(row.englishDubSourceCount),
      evidence: row.englishDubEvidence ?? null,
    },
  };
}

const catalog = rows.map(catalogRecord);
const snapshotDate = generatedAt.slice(0, 10);
const history = Object.fromEntries(catalog.map((item) => {
  const stats = item.stats;
  const analytics = item.analytics;
  return [String(item.id), [{
    d: snapshotDate,
    p: stats.popularity ?? 0,
    f: stats.favourites ?? 0,
    s: stats.meanScore,
    r: analytics.fanFavouriteRaw ?? 0,
    rp: analytics.fanRatioPercentile ?? 0,
    pp: analytics.popularityPercentile ?? 0,
    ds: analytics.fanFavouriteDiscoveryScore ?? 0,
    dp: analytics.fanFavouriteDiscoveryPercentile ?? 0,
  }]];
}));

async function writeChunk(datasetName, index, value) {
  const fileName = `${datasetName}-${String(index).padStart(3, "0")}.json.gz`;
  const bytes = gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 });
  await fs.writeFile(path.join(buildRoot, fileName), bytes);
  return {
    path: `builds/${buildId}/${fileName}`,
    bytes: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    records: Array.isArray(value) ? value.length : Object.keys(value).length,
  };
}

async function writeArrayDataset(name, values, chunkSize = 5_000) {
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(await writeChunk(name, chunks.length, values.slice(index, index + chunkSize)));
  }
  return { kind: "array", count: values.length, chunks };
}

async function writeObjectDataset(name, value, chunkSize = 5_000) {
  const entries = Object.entries(value);
  const chunks = [];
  for (let index = 0; index < entries.length; index += chunkSize) {
    chunks.push(await writeChunk(name, chunks.length, Object.fromEntries(entries.slice(index, index + chunkSize))));
  }
  return { kind: "object", count: entries.length, chunks };
}

const datasets = {
  catalog: await writeArrayDataset("catalog", catalog),
  tags: await writeArrayDataset("tags", tags),
  history: await writeObjectDataset("history", history),
};

const manifest = {
  contract: "manhwa-frontend-data",
  schemaVersion: 1,
  buildId,
  generatedAt,
  datasets,
  source: {
    catalogue: "AniList GraphQL API",
    titlePolicy: "Use AniList English title when present; otherwise show AniList romanized/user-preferred title and flag the row in the audit data.",
  coverPolicy: "Use AniList Media.coverImage.extraLarge, with large/medium fallback. Feed accent colors use AniList Media.coverImage.color. Missing values remain null.",
    tagPolicy: "Use AniList genres plus AniList MediaTag IDs, categories, and per-title relevance ranks. Do not map AniList ranks into MangaBaka weight classes.",
    episodePolicy: "AniList episodes are stored in the shared total_chapters field for compatibility and displayed as Episodes in the anime shell.",
    historyPolicy: "One dated snapshot is included so the shared frontend contract can load; it is not a time-series history feed.",
  },
};

await fs.writeFile(path.join(outputRoot, "meta", "data-manifest.json"), JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(outputRoot, "meta", "anime-export-info.json"), JSON.stringify({
  generatedAt,
  buildId,
  source: raw.source,
  sourceUrl: raw.sourceUrl,
  summary: raw.summary,
  filterMethod: raw.filterMethod,
  externalSources: raw.externalSources,
  notes: manifest.source,
}, null, 2));

console.log(JSON.stringify({ outputRoot, buildId, rows: catalog.length, tags: tags.length, history: Object.keys(history).length, datasets }, null, 2));
