import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const API_URL = "https://graphql.anilist.co";
const MIN_POPULARITY = Number(process.env.MIN_POPULARITY ?? 1000);
// AniList GraphQL Int values are signed 32-bit integers. Using the maximum
// legal upper bound keeps this collector independent of today's top title.
const MAX_POPULARITY = Number(process.env.MAX_POPULARITY ?? 2_147_483_647);
const PER_PAGE = 50;
const QUERY_CAP = 5000;
const DELAY_MS = Number(process.env.ANILIST_DELAY_MS ?? 2100);
const outputDir = path.resolve(process.env.OUTPUT_DIR ?? "./data");

const QUERY = `
query ($page: Int!, $perPage: Int!, $minPopularity: Int!, $maxPopularity: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage }
    media(
      type: ANIME,
      popularity_greater: $minPopularity,
      popularity_lesser: $maxPopularity,
      sort: POPULARITY_DESC
    ) {
      id
      title { romaji english native userPreferred }
      coverImage { extraLarge large medium color }
      description(asHtml: false)
      type
      format
      status
      startDate { year month day }
      endDate { year month day }
      season
      seasonYear
      episodes
      duration
      countryOfOrigin
      source
      isAdult
      genres
      synonyms
      averageScore
      meanScore
      popularity
      favourites
      tags { id name category rank isGeneralSpoiler isMediaSpoiler }
      externalLinks { url site type language isDisabled }
      staff(sort: RELEVANCE) { edges { role node { name { full } } } }
      siteUrl
    }
  }
}`;

const FORMATS = ["TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"];

const CREATOR_ROLE_PATTERNS = [
  /\boriginal\s+(creator|story|work|concept|plan|draft)\b/i,
  /\b(creator|author|manga|novel|light novel|story|screenplay|screenwriter|writer|script|series composition)\b/i,
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dateValue(date) {
  if (!date?.year) return null;
  const month = String(date.month ?? 1).padStart(2, "0");
  const day = String(date.day ?? 1).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function titleFlag(item) {
  const genres = (item.genres ?? []).map(normalized);
  const tags = (item.tags ?? []).map((tag) => normalized(tag.name));
  const strongBlGl = new Set([
    "boys love",
    "girls love",
    "boys' love",
    "girls' love",
    "yaoi",
    "shounen ai",
    "yuri",
    "shoujo ai",
  ]);
  const weakBlGl = new Set(["female/female", "male/male", "romance between men", "romance between women"]);
  const adultTags = new Set(["hentai", "explicit sex", "pornographic"]);
  const blGlEvidence = [...new Set([...genres, ...tags].filter((value) => strongBlGl.has(value)))];
  const weakEvidence = [...new Set([...genres, ...tags].filter((value) => weakBlGl.has(value)))];
  const adultEvidence = [...new Set([...genres, ...tags].filter((value) => adultTags.has(value)))];
  const hasHentaiGenre = genres.includes("hentai");
  const hasEcchi = genres.includes("ecchi") || tags.includes("ecchi");
  return {
    blGlHardFlag: blGlEvidence.length > 0,
    blGlReviewFlag: weakEvidence.length > 0,
    blGlEvidence: blGlEvidence.join(", "),
    blGlReviewEvidence: weakEvidence.join(", "),
    hentaiHardFlag: Boolean(item.isAdult || hasHentaiGenre || adultEvidence.length),
    hentaiEvidence: [...new Set([item.isAdult ? "AniList isAdult" : null, ...adultEvidence])].filter(Boolean).join(", "),
    ecchiSignal: hasEcchi,
  };
}

function normalizeStaffCredits(item) {
  const credits = [];
  const seen = new Set();
  for (const edge of item.staff?.edges ?? []) {
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

function isCreatorRole(role) {
  return CREATOR_ROLE_PATTERNS.some((pattern) => pattern.test(role));
}

function creatorCreditsFromStaff(staffCredits) {
  return staffCredits.filter((credit) => isCreatorRole(credit.role));
}

function normalizeRow(item) {
  const flags = titleFlag(item);
  const englishTitle = item.title?.english?.trim() || null;
  const tags = item.tags ?? [];
  const links = (item.externalLinks ?? []).filter((link) => !link.isDisabled);
  const staffCredits = normalizeStaffCredits(item);
  const creatorCredits = creatorCreditsFromStaff(staffCredits);
  const annLink = links.find((link) => normalized(link.site).includes("anime news network"))?.url ?? null;
  const anidbLink = links.find((link) => normalized(link.site) === "anidb")?.url ?? null;
  return {
    anilistId: item.id,
    titleEnglish: englishTitle,
    titleDisplay: englishTitle || item.title?.romaji || item.title?.userPreferred || item.title?.native || `AniList ${item.id}`,
    titleRomaji: item.title?.romaji ?? null,
    titleNative: item.title?.native ?? null,
    titleUserPreferred: item.title?.userPreferred ?? null,
    coverImage: item.coverImage?.extraLarge ?? item.coverImage?.large ?? item.coverImage?.medium ?? null,
    coverColor: item.coverImage?.color ?? null,
    titleEnglishStatus: englishTitle ? "AniList English title" : "No AniList English title",
    description: item.description?.trim() || null,
    titleSynonyms: (item.synonyms ?? []).join(" | "),
    format: item.format ?? null,
    status: item.status ?? null,
    startDate: dateValue(item.startDate),
    endDate: dateValue(item.endDate),
    season: item.season ?? null,
    seasonYear: item.seasonYear ?? null,
    episodes: item.episodes ?? null,
    durationMinutes: item.duration ?? null,
    countryOfOrigin: item.countryOfOrigin ?? null,
    source: item.source ?? null,
    isAdult: Boolean(item.isAdult),
    genres: (item.genres ?? []).join(", "),
    tagDetails: tags.map((tag) => ({
      id: tag.id ?? null,
      name: tag.name,
      category: tag.category ?? null,
      rank: tag.rank ?? null,
      isGeneralSpoiler: Boolean(tag.isGeneralSpoiler),
      isMediaSpoiler: Boolean(tag.isMediaSpoiler),
    })),
    tags: tags.map((tag) => `${tag.name} [${tag.category ?? "uncategorized"}; ${tag.rank ?? "?"}]`).join(" | "),
    tagNames: tags.map((tag) => tag.name).join(", "),
    averageScore: item.averageScore ?? null,
    meanScore: item.meanScore ?? null,
    popularity: item.popularity ?? 0,
    favourites: item.favourites ?? 0,
    anilistUrl: item.siteUrl ?? `https://anilist.co/anime/${item.id}`,
    annLink,
    anidbLink,
    externalLinkSites: [...new Set(links.map((link) => link.site).filter(Boolean))].join(", "),
    externalLinks: links.map((link) => ({
      url: link.url,
      site: link.site ?? null,
      type: link.type ?? null,
      language: link.language ?? null,
    })),
    staffCredits,
    creatorCredits,
    creatorNames: [...new Set(creatorCredits.map((credit) => credit.name))],
    ...flags,
    englishDubStatus: "Not provided by AniList",
    englishDubEvidence: "Needs a separate dub source or review",
  };
}

async function queryPage(variables) {
  let attempt = 0;
  while (true) {
    await sleep(DELAY_MS);
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables }),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`AniList returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
    }
    if (response.status === 429 || body.errors?.some((error) => error.status === 429)) {
      attempt += 1;
      if (attempt > 6) throw new Error("AniList rate limit did not recover after six retries.");
      const retryAfter = Number(response.headers.get("retry-after") ?? 30);
      console.log(`Rate limited. Waiting ${retryAfter}s before retry ${attempt}/6.`);
      await sleep(Math.max(retryAfter * 1000, DELAY_MS));
      continue;
    }
    if (!response.ok || body.errors?.length) {
      throw new Error(`AniList query failed (${response.status}): ${JSON.stringify(body.errors ?? body).slice(0, 1000)}`);
    }
    return body.data.Page;
  }
}

const checkedExactPopularities = new Set();

async function fetchExactPopularity(popularity, rows, ranges) {
  if (checkedExactPopularities.has(popularity)) return;
  checkedExactPopularities.add(popularity);
  await fetchRange(popularity, popularity + 1, rows, ranges, { exactPopularity: true });
}

async function fetchRange(lowInclusive, highExclusive, rows, ranges, options = {}) {
  const range = {
    lowInclusive,
    highExclusive,
    reportedTotal: null,
    split: false,
    exactPopularity: Boolean(options.exactPopularity),
    pagesFetched: 0,
    rowsFetched: 0,
  };
  ranges.push(range);
  const pages = [];
  let complete = false;
  for (let pageNumber = 1; pageNumber <= QUERY_CAP / PER_PAGE; pageNumber += 1) {
    const page = await queryPage({
      page: pageNumber,
      perPage: PER_PAGE,
      minPopularity: lowInclusive - 1,
      maxPopularity: highExclusive,
    });
    const media = page.media ?? [];
    pages.push(media);
    range.pagesFetched = pageNumber;
    range.rowsFetched += media.length;
    console.log(`Fetched page ${pageNumber} for ${lowInclusive}-${highExclusive - 1}. Rows in range: ${range.rowsFetched}. Rows so far: ${rows.length}.`);
    if (media.length < PER_PAGE) {
      complete = true;
      break;
    }
  }

  const appendPages = () => {
    for (const pageRows of pages) {
      for (const item of pageRows) rows.push(normalizeRow(item));
    }
  };

  if (!complete && !options.exactPopularity) {
    const boundaryPopularity = pages.at(-1)?.at(-1)?.popularity ?? null;
    appendPages();
    range.boundaryPopularity = boundaryPopularity;
    if (boundaryPopularity != null && boundaryPopularity > lowInclusive && boundaryPopularity < highExclusive) {
      range.split = true;
      range.partitionNote = "range partitioned at the last observed popularity boundary";
      await fetchExactPopularity(boundaryPopularity, rows, ranges);
      await fetchRange(lowInclusive, boundaryPopularity, rows, ranges);
      return;
    }
  }

  if (!complete && highExclusive - lowInclusive > 1 && !options.exactPopularity) {
    // This is only a fallback for an unusual response where no usable
    // popularity boundary was present in the returned page block.
    const midpoint = Math.floor((lowInclusive + highExclusive) / 2);
    range.split = true;
    range.completeness = "range split at midpoint after reaching AniList's 5,000-row query ceiling";
    await fetchRange(lowInclusive, midpoint, rows, ranges);
    await fetchRange(midpoint, highExclusive, rows, ranges);
    return;
  }
  if (!complete) {
    range.completeness = options.exactPopularity
      ? "one popularity value may contain more than AniList's 5,000 accessible rows"
      : "range could not be partitioned further without a usable popularity boundary";
  }
  if (complete || options.exactPopularity) appendPages();
}

function upperBound(sorted, value, key = (item) => item) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (key(sorted[middle]) <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function addFanRank(rows) {
  const eligible = rows.filter((row) => row.popularity > 0 && row.favourites >= 0);
  const popularityValues = eligible.map((row) => Math.log10(Math.max(row.popularity, 1))).sort((a, b) => a - b);
  const ratioValues = eligible.map((row) => (row.favourites / row.popularity) * 100).sort((a, b) => a - b);
  const scored = eligible.map((row) => {
    const fanPercent = (row.favourites / row.popularity) * 100;
    const popularityPercentile = (upperBound(popularityValues, Math.log10(Math.max(row.popularity, 1))) / eligible.length) * 100;
    const fanRatioPercentile = (upperBound(ratioValues, fanPercent) / eligible.length) * 100;
    const evidenceWeight = 1 / (1 + Math.exp(-((popularityPercentile - 20) / 12)));
    const discoveryScore = fanRatioPercentile * evidenceWeight;
    return { row, fanPercent, popularityPercentile, fanRatioPercentile, evidenceWeight, discoveryScore };
  });
  const discoveryValues = scored.map((entry) => entry.discoveryScore).sort((a, b) => a - b);
  for (const entry of scored) {
    entry.row.fanPercent = Number(entry.fanPercent.toFixed(4));
    entry.row.fanRatioPercentile = Number(entry.fanRatioPercentile.toFixed(4));
    entry.row.popularityPercentile = Number(entry.popularityPercentile.toFixed(4));
    entry.row.evidenceWeight = Number(entry.evidenceWeight.toFixed(4));
    entry.row.discoveryScore = Number(entry.discoveryScore.toFixed(4));
    entry.row.fanRank = Number(((upperBound(discoveryValues, entry.discoveryScore) / eligible.length) * 100).toFixed(4));
  }
  return { eligibleCount: eligible.length, rowsWithStats: scored.length };
}

const rawRows = [];
const ranges = [];
await fetchRange(MIN_POPULARITY, MAX_POPULARITY, rawRows, ranges);

const deduped = new Map();
for (const row of rawRows) deduped.set(row.anilistId, row);
const rows = [...deduped.values()].sort((a, b) => b.popularity - a.popularity || a.anilistId - b.anilistId);
const fanRankSummary = addFanRank(rows);
const unresolvedRanges = ranges.filter((range) =>
  String(range.completeness ?? "").includes("may contain") ||
  String(range.completeness ?? "").includes("could not")
);
const missingEnglishTitles = rows.filter((row) => !row.titleEnglish).length;
const hardBlGl = rows.filter((row) => row.blGlHardFlag).length;
const reviewBlGl = rows.filter((row) => row.blGlReviewFlag).length;
const adultRows = rows.filter((row) => row.hentaiHardFlag).length;

const payload = {
  generatedAt: new Date().toISOString(),
  source: "AniList GraphQL API",
  sourceUrl: API_URL,
  minPopularity: MIN_POPULARITY,
  maxPopularityExclusive: MAX_POPULARITY,
  queryCap: QUERY_CAP,
  collectionRule: "All ANIME entries with popularity >= minPopularity, collected through popularity-range queries and deduplicated by AniList ID.",
  caveats: [
    "AniList caps a single browse query at 5,000 results. Popularity ranges are split recursively to avoid losing the middle of the population.",
    "A popularity value with more than 5,000 titles remains a boundary-completeness risk and is reported separately.",
    "AniList does not provide a reliable series-level English-dub boolean in the fields used here.",
    "English titles are never invented. Missing AniList English titles fall back to the romanized title for display and remain flagged.",
    "Fan Rank is relative to this collected population and should not be treated as a permanent global value until the collection is complete.",
  ],
  summary: {
    rawRows: rawRows.length,
    uniqueRows: rows.length,
    duplicateRows: rawRows.length - rows.length,
    rangesChecked: ranges.length,
    unresolvedRangeCount: unresolvedRanges.length,
    missingEnglishTitles,
    hardBlGl,
    reviewBlGl,
    adultRows,
    ...fanRankSummary,
  },
  ranges,
  rows,
};

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "anime-anilist-prototype.json"), JSON.stringify(payload, null, 2) + "\n");
console.log(JSON.stringify(payload.summary, null, 2));
