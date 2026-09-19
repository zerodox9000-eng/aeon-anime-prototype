import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const inputFile = path.resolve(process.env.INPUT_FILE ?? "./data/anime-anilist-prototype.json");
const outputFile = path.resolve(process.env.OUTPUT_FILE ?? "./data/anime-anilist-prototype-enriched.json");

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function splitValues(value) {
  return String(value ?? "")
    .split(",")
    .map(normalize)
    .filter(Boolean);
}

function parseTagDetails(row) {
  if (Array.isArray(row.tagDetails)) return row.tagDetails;
  return String(row.tags ?? "")
    .split(" | ")
    .map((part) => {
      const match = part.match(/^(.*) \[([^;]+); ([^\]]+)\]$/);
      if (!match) return { id: null, name: part, category: null, rank: null };
      const rank = Number(match[3]);
      return {
        id: null,
        name: match[1],
        category: match[2],
        rank: Number.isFinite(rank) ? rank : null,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      };
    })
    .filter((tag) => tag.name);
}

const DIRECT_GENRES = new Map([
  ["boys love", "BL"],
  ["girls love", "GL"],
]);

const EXPLICIT_TAGS = new Map([
  ["boys' love", "BL"],
  ["boys love", "BL"],
  ["girls' love", "GL"],
  ["girls love", "GL"],
]);

const UMBRELLA_TAGS = new Map([
  ["yaoi", "BL"],
  ["shounen ai", "BL"],
  ["yuri", "GL"],
  ["shoujo ai", "GL"],
]);

const PAIR_TAGS = new Map([
  ["male/male", "BL"],
  ["female/female", "GL"],
  ["romance between men", "BL"],
  ["romance between women", "GL"],
]);

const SUPPORT_TAGS = new Set([
  "lgbtq+ themes",
  "lgbt themes",
  "bisexual",
  "gay",
  "lesbian",
  "homosexual",
  "male/male",
  "female/female",
  "romance between men",
  "romance between women",
]);

function distinct(values) {
  return [...new Set(values.filter(Boolean))];
}

function classifyBlGl(row) {
  const genres = splitValues(row.genres);
  const tags = parseTagDetails(row).map((tag) => ({ ...tag, normalizedName: normalize(tag.name) }));
  const directGenreEvidence = genres
    .filter((genre) => DIRECT_GENRES.has(genre))
    .map((genre) => ({ label: genre, type: DIRECT_GENRES.get(genre), source: "genre", rank: null }));
  const explicitEvidence = tags
    .filter((tag) => EXPLICIT_TAGS.has(tag.normalizedName))
    .map((tag) => ({ label: tag.name, type: EXPLICIT_TAGS.get(tag.normalizedName), source: "explicit tag", rank: tag.rank }));
  const umbrellaEvidence = tags
    .filter((tag) => UMBRELLA_TAGS.has(tag.normalizedName))
    .map((tag) => ({ label: tag.name, type: UMBRELLA_TAGS.get(tag.normalizedName), source: "umbrella tag", rank: tag.rank }));
  const pairEvidence = tags
    .filter((tag) => PAIR_TAGS.has(tag.normalizedName))
    .map((tag) => ({ label: tag.name, type: PAIR_TAGS.get(tag.normalizedName), source: "relationship tag", rank: tag.rank }));
  const supportEvidence = tags.filter((tag) => SUPPORT_TAGS.has(tag.normalizedName));
  const evidence = [...directGenreEvidence, ...explicitEvidence, ...umbrellaEvidence, ...pairEvidence];
  const types = distinct(evidence.map((entry) => entry.type));
  const highestPrimaryRank = Math.max(...evidence.map((entry) => entry.rank ?? 0), 0);
  const hasSupportingSignal = supportEvidence.length > 0 || genres.includes("romance");
  const strongestExplicit = explicitEvidence.some((entry) => (entry.rank ?? 0) >= 80);
  const strongestUmbrella = umbrellaEvidence.some((entry) => (entry.rank ?? 0) >= 85);

  let status = "keep";
  let confidence = "none";
  let recommendedAction = "keep";
  let reason = "No BL/GL genre or meaningful BL/GL tag evidence found.";

  if (directGenreEvidence.length) {
    status = "confirmed";
    confidence = "high";
    recommendedAction = "exclude";
    reason = `AniList genre: ${directGenreEvidence.map((entry) => entry.label).join(", ")}.`;
  } else if (strongestExplicit && hasSupportingSignal) {
    status = "likely";
    confidence = "high";
    recommendedAction = "review";
    reason = "High-ranked explicit BL/GL tag with independent supporting evidence.";
  } else if (strongestExplicit || (strongestUmbrella && hasSupportingSignal)) {
    status = "likely";
    confidence = "medium";
    recommendedAction = "review";
    reason = "Strong BL/GL tag evidence, but AniList does not provide a definitive genre classification for this row.";
  } else if (evidence.length) {
    status = "review";
    confidence = "low";
    recommendedAction = "review";
    reason = "A BL/GL-related tag is present, but its relevance or meaning is not strong enough for automatic exclusion.";
  }

  return {
    blGlStatus: status,
    blGlConfidence: confidence,
    blGlRecommendedAction: recommendedAction,
    // Two intentionally different views make the trade-off explicit:
    // strict is the high-precision automatic filter; broad is a discovery
    // queue that still needs human/source review before being hidden.
    blGlStrictExclude: status === "confirmed" || (status === "likely" && confidence === "high"),
    blGlBroadExclude: status === "confirmed" || status === "likely",
    blGlNeedsReview: status === "review" || status === "likely",
    blGlType: types.length === 1 ? types[0] : types.length > 1 ? "BL + GL" : null,
    blGlHighestEvidenceRank: highestPrimaryRank || null,
    blGlEvidence: evidence.map((entry) => `${entry.label}${entry.rank == null ? "" : ` (${entry.rank})`}`).join(" | "),
    blGlSupportingEvidence: supportEvidence.map((tag) => `${tag.name}${tag.rank == null ? "" : ` (${tag.rank})`}`).join(" | "),
    blGlReason: reason,
  };
}

function classifyHentai(row) {
  const genres = splitValues(row.genres);
  const tags = parseTagDetails(row).map((tag) => normalize(tag.name));
  const evidence = [];
  if (row.isAdult) evidence.push("AniList isAdult");
  if (genres.includes("hentai")) evidence.push("Hentai genre");
  if (tags.includes("hentai")) evidence.push("Hentai tag");
  if (tags.includes("explicit sex") || tags.includes("pornographic")) evidence.push("Explicit content tag");
  if (evidence.length) return { hentaiStatus: "confirmed", hentaiRecommendedAction: "exclude", hentaiEvidence: evidence.join(" | ") };
  if (genres.includes("ecchi") || tags.includes("ecchi")) {
    return { hentaiStatus: "separate ecchi signal", hentaiRecommendedAction: "review", hentaiEvidence: "Ecchi is not treated as Hentai." };
  }
  return { hentaiStatus: "keep", hentaiRecommendedAction: "keep", hentaiEvidence: "" };
}

const payload = JSON.parse(await fs.readFile(inputFile, "utf8"));
const rows = payload.rows.map((row) => ({ ...row, ...classifyBlGl(row), ...classifyHentai(row) }));
const unresolvedRangeCount = (payload.ranges ?? []).filter((range) => {
  const note = String(range.completeness ?? "");
  return note.includes("may contain") || note.includes("could not");
}).length;
const enriched = {
  ...payload,
  filterMethod: {
    blGl: "The raw catalogue is never removed. Strict exclusion uses direct AniList BL/GL genres or a high-ranked explicit BL/GL tag with independent supporting evidence; broad exclusion includes medium-confidence likely rows for review. AniList tag rank is relevance, not a genre truth score, so an umbrella tag such as Yuri alone is not enough for automatic exclusion.",
    hentai: "AniList isAdult, Hentai genre, and direct adult tags are excluded; Ecchi remains a separate review signal.",
  },
  rows,
  summary: {
    ...payload.summary,
    unresolvedRangeCount,
    blGlConfirmed: rows.filter((row) => row.blGlStatus === "confirmed").length,
    blGlLikely: rows.filter((row) => row.blGlStatus === "likely").length,
    blGlReview: rows.filter((row) => row.blGlStatus === "review").length,
    blGlStrictExclude: rows.filter((row) => row.blGlStrictExclude).length,
    blGlBroadExclude: rows.filter((row) => row.blGlBroadExclude).length,
    blGlNeedsReview: rows.filter((row) => row.blGlNeedsReview).length,
    hentaiConfirmed: rows.filter((row) => row.hentaiStatus === "confirmed").length,
    ecchiReview: rows.filter((row) => row.hentaiStatus === "separate ecchi signal").length,
  },
};

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, JSON.stringify(enriched, null, 2) + "\n");
console.log(JSON.stringify(enriched.summary, null, 2));
