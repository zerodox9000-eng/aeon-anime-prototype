import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const inputFile = path.resolve(process.env.INPUT_FILE ?? "./data/anime-anilist-prototype-enriched.json");
const outputFile = path.resolve(process.env.OUTPUT_FILE ?? "./data/anime-anilist-prototype-final.json");
const BASE_URL = "https://raw.githubusercontent.com/Joelis57/MyDubList/main";
const LEVELS = ["low", "normal", "high", "very-high"];
const LEVEL_RANK = new Map(LEVELS.map((level, index) => [level, index]));

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`MyDubList request failed (${response.status}): ${url}`);
  return response.json();
}

async function fetchJsonl(url) {
  const response = await fetch(url, { headers: { accept: "text/plain" } });
  if (!response.ok) throw new Error(`MyDubList mapping request failed (${response.status}): ${url}`);
  const text = await response.text();
  const mapping = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    const anilistId = Number(record.anilist_id);
    const malId = Number(record.mal_id);
    if (!Number.isInteger(anilistId) || !Number.isInteger(malId)) continue;
    const malIds = mapping.get(anilistId) ?? new Set();
    malIds.add(malId);
    mapping.set(anilistId, malIds);
  }
  return mapping;
}

const payload = JSON.parse(await fs.readFile(inputFile, "utf8"));
const mapping = await fetchJsonl(`${BASE_URL}/dubs/mappings/mappings_anilist.jsonl`);
const confidenceData = new Map();
for (const level of LEVELS) {
  const data = await fetchJson(`${BASE_URL}/dubs/confidence/${level}/dubbed_english.json`);
  confidenceData.set(level, {
    dubbed: new Set((data.dubbed ?? []).map(Number)),
    partial: new Set((data.partial ?? []).map(Number)),
  });
}
const counts = await fetchJson(`${BASE_URL}/dubs/counts/dubbed_english.json`);

function bestDubEvidence(anilistId) {
  const malIds = [...(mapping.get(anilistId) ?? [])];
  let bestLevel = null;
  let isPartial = false;
  let sourceCount = 0;
  for (const malId of malIds) {
    const count = Number(counts[String(malId)] ?? 0);
    if (Number.isFinite(count)) sourceCount = Math.max(sourceCount, count);
    for (const level of LEVELS) {
      const data = confidenceData.get(level);
      if (data.partial.has(malId)) isPartial = true;
      if (data.dubbed.has(malId) && (!bestLevel || LEVEL_RANK.get(level) > LEVEL_RANK.get(bestLevel))) bestLevel = level;
    }
  }
  if (isPartial) {
    return {
      mappedMalIds: malIds.join(", "),
      englishDubStatus: "partial",
      englishDubConfidence: bestLevel ?? "partial-only",
      englishDubAvailable: true,
      englishDubSourceCount: sourceCount || null,
      englishDubEvidence: "MyDubList marks at least one mapped MAL entry as partial.",
    };
  }
  if (bestLevel) {
    return {
      mappedMalIds: malIds.join(", "),
      englishDubStatus: "reported",
      englishDubConfidence: bestLevel,
      englishDubAvailable: true,
      englishDubSourceCount: sourceCount || null,
      englishDubEvidence: `MyDubList confidence tier: ${bestLevel}; source count: ${sourceCount || "not reported"}.`,
    };
  }
  return {
    mappedMalIds: malIds.join(", "),
    englishDubStatus: malIds.length ? "not listed" : "unmapped",
    englishDubConfidence: "unknown",
    englishDubAvailable: false,
    englishDubSourceCount: null,
    englishDubEvidence: malIds.length ? "No English-dub record in the current MyDubList confidence files." : "No AniList-to-MAL mapping in the current MyDubList mapping file.",
  };
}

const rows = payload.rows.map((row) => ({ ...row, ...bestDubEvidence(Number(row.anilistId)) }));
const enriched = {
  ...payload,
  externalSources: {
    ...(payload.externalSources ?? {}),
    myDubList: {
      name: "MyDubList",
      repoUrl: "https://github.com/Joelis57/MyDubList",
      siteUrl: "https://mydublist.com",
      license: "CC BY 4.0",
      attribution: "Dub data © MyDubList - https://mydublist.com - (CC BY 4.0)",
      method: "AniList IDs were joined to all mapped MAL IDs, then checked against MyDubList English confidence and partial files.",
      caveat: "A missing MyDubList record means unknown coverage, not proof that no English dub exists.",
    },
  },
  rows,
  summary: {
    ...payload.summary,
    englishDubReported: rows.filter((row) => row.englishDubStatus === "reported").length,
    englishDubPartial: rows.filter((row) => row.englishDubStatus === "partial").length,
    englishDubUnknownOrUnmapped: rows.filter((row) => row.englishDubStatus === "unknown" || row.englishDubStatus === "not listed" || row.englishDubStatus === "unmapped").length,
    englishDubHighOrBetter: rows.filter((row) => ["high", "very-high"].includes(row.englishDubConfidence)).length,
  },
};

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, JSON.stringify(enriched, null, 2) + "\n");
console.log(JSON.stringify(enriched.summary, null, 2));
