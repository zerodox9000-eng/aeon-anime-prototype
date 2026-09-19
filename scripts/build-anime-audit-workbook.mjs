import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const repoRoot = path.resolve(process.env.REPO_ROOT ?? process.cwd());
const inputFile = path.resolve(process.env.INPUT_FILE ?? path.join(repoRoot, "data", "anime-anilist-prototype-final.json"));
const outputDir = path.resolve(process.env.OUTPUT_DIR ?? path.join(repoRoot, "workbook-output"));
const outputPath = path.resolve(process.env.OUTPUT_PATH ?? path.join(outputDir, "aeon-anime-fan-rank-audit.xlsx"));
const renderDir = path.resolve(process.env.RENDER_DIR ?? path.join(outputDir, "renders"));
const fontFamily = "Arial";

const palette = {
  ink: "#1F2937",
  muted: "#5B6472",
  navy: "#1F4E78",
  navyLight: "#DCE6F1",
  teal: "#0F766E",
  tealLight: "#DDF3EF",
  amber: "#B45309",
  amberLight: "#FEF3C7",
  red: "#B91C1C",
  redLight: "#FEE2E2",
  green: "#166534",
  greenLight: "#DCFCE7",
  slateLight: "#F3F4F6",
  line: "#D1D5DB",
  white: "#FFFFFF",
};

function colLetter(index) {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function asDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function valueOrNull(value) {
  return value === undefined || value === "" ? null : value;
}

function displayBool(value) {
  return value === true ? "Yes" : value === false ? "No" : null;
}

function shortTitle(row) {
  return String(row.titleEnglish || row.titleDisplay || row.titleRomaji || `AniList ${row.anilistId}`);
}

function titleAndId(row) {
  return `${shortTitle(row)} [${row.anilistId}]`;
}

function setBaseSheetStyle(sheet) {
  sheet.showGridLines = false;
  const used = sheet.getUsedRange();
  if (used) {
    used.format.verticalAlignment = "center";
  }
}

function styleTitle(sheet, rangeAddress, text) {
  const range = sheet.getRange(rangeAddress);
  range.values = [[text]];
  range.format.font = { name: fontFamily, size: 15, bold: true, color: palette.navy };
  range.format.rowHeight = 24;
}

function styleSection(sheet, rangeAddress, text) {
  const range = sheet.getRange(rangeAddress);
  range.getCell(0, 0).values = [[text]];
  range.format = {
    fill: palette.navy,
    font: { name: fontFamily, size: 10, bold: true, color: palette.white },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  range.format.rowHeight = 20;
}

function styleHeader(range) {
  range.format = {
    fill: palette.navy,
    font: { name: fontFamily, size: 9, bold: true, color: palette.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: palette.white },
  };
  range.format.rowHeight = 30;
}

function styleTableBody(range) {
  range.format.font = { name: fontFamily, size: 9, color: palette.ink };
  range.format.verticalAlignment = "center";
  range.format.borders = { preset: "insideHorizontal", style: "thin", color: "#E5E7EB" };
}

function addTable(sheet, values, startRow, startCol, tableName) {
  const rowCount = values.length;
  const colCount = values[0]?.length ?? 0;
  const start = `${colLetter(startCol)}${startRow}`;
  const end = `${colLetter(startCol + colCount - 1)}${startRow + rowCount - 1}`;
  const range = sheet.getRange(`${start}:${end}`);
  range.values = values;
  const table = sheet.tables.add(`${start}:${end}`, true, tableName);
  table.showFilterButton = true;
  table.showBandedColumns = false;
  styleHeader(sheet.getRange(`${start}:${colLetter(startCol + colCount - 1)}${startRow}`));
  if (rowCount > 1) styleTableBody(sheet.getRange(`${colLetter(startCol)}${startRow + 1}:${end}`));
  return { table, start, end, startRow, startCol, rowCount, colCount };
}

function setWidths(sheet, widths) {
  for (const [column, width] of Object.entries(widths)) {
    sheet.getRange(`${column}:${column}`).format.columnWidth = width;
  }
}

function setStatusFormatting(sheet, rangeAddress) {
  const range = sheet.getRange(rangeAddress);
  range.conditionalFormats.add("containsText", { text: "exclude", format: { fill: palette.redLight, font: { color: palette.red, bold: true } } });
  range.conditionalFormats.add("containsText", { text: "review", format: { fill: palette.amberLight, font: { color: palette.amber, bold: true } } });
  range.conditionalFormats.add("containsText", { text: "keep", format: { fill: palette.greenLight, font: { color: palette.green } } });
  range.conditionalFormats.add("containsText", { text: "reported", format: { fill: palette.greenLight, font: { color: palette.green } } });
  range.conditionalFormats.add("containsText", { text: "partial", format: { fill: palette.amberLight, font: { color: palette.amber } } });
  range.conditionalFormats.add("containsText", { text: "unknown", format: { fill: palette.amberLight, font: { color: palette.amber } } });
  range.conditionalFormats.add("containsText", { text: "not listed", format: { fill: palette.amberLight, font: { color: palette.amber } } });
  range.conditionalFormats.add("containsText", { text: "unmapped", format: { fill: palette.amberLight, font: { color: palette.amber } } });
}

function makeSummaryRows(payload) {
  const s = payload.summary;
  return [
    ["Unique anime rows", s.uniqueRows, "One row per AniList ID after deduplication."],
    ["Popularity cutoff", `≥ ${payload.minPopularity}`, "All years are included. No year cutoff was used."],
    ["AniList query ranges", s.rangesChecked, s.unresolvedRangeCount === 0 ? "No unresolved range was left in this snapshot." : "Some ranges still need review."],
    ["Missing AniList English title", s.missingEnglishTitles, `${((s.missingEnglishTitles / s.uniqueRows) * 100).toFixed(1)}% use a romanized/native fallback for display.`],
    ["Fan Rank population", s.rowsWithStats, "Every collected row has the four Fan Rank components in this snapshot."],
    ["BL/GL strict exclude", s.blGlStrictExclude, "High-precision automatic view. Raw rows remain available."],
    ["BL/GL broad review", s.blGlBroadExclude, "Likely rows to inspect before hiding in a broad view."],
    ["BL/GL any signal", s.blGlNeedsReview, "Includes low-confidence umbrella tags such as Yuri alone."],
    ["Adult/Hentai confirmed", s.hentaiConfirmed, "AniList isAdult, Hentai genre, or direct adult tags."],
    ["Ecchi separate signal", s.ecchiReview, "Not treated as Hentai automatically."],
    ["English dub reported", s.englishDubReported, "MyDubList has an English-dub record in a confidence file."],
    ["English dub partial", s.englishDubPartial, "MyDubList marks at least one mapped MAL entry partial."],
    ["Dub unknown/not mapped", s.englishDubUnknownOrUnmapped, "Unknown coverage, not proof that no dub exists."],
    ["Dub high/very-high", s.englishDubHighOrBetter, "MyDubList confidence tier is high or very-high."],
  ];
}

function buildFanRankGuide(sheet, payload, examples) {
  styleTitle(sheet, "A1", "Fan Rank guide");
  sheet.getRange("A2").values = [["Fan Rank is a relative discovery signal for this collected AniList population. It is not an audience rating, a review score, or a claim that one title is objectively better."]];
  sheet.getRange("A2:H2").merge();
  sheet.getRange("A2:H2").format = { font: { name: fontFamily, size: 10, italic: true, color: palette.muted }, wrapText: true };
  sheet.getRange("A2:H2").format.rowHeight = 32;

  styleSection(sheet, "A4:D4", "What each metric means");
  const metricRows = [
    ["Metric", "Uses", "Plain-language meaning", "What it does not mean"],
    ["Popularity", "AniList popularity", "How widely represented a title is in AniList's popularity measure.", "Not unique viewers, revenue, or worldwide audience size."],
    ["Favourites per popularity", "favourites ÷ popularity × 100", "How strongly people who engage with the title save it as a favourite relative to its reach.", "Not a star rating and not a percentage of all viewers who loved it."],
    ["Popularity percentile", "log10(popularity) position in this dataset", "Where the title sits by reach after reducing the dominance of extremely large titles.", "Not a probability of being popular outside this dataset."],
    ["Fan-ratio percentile", "position of favourites/popularity ratio", "How unusual or strong the favourite-to-reach signal is compared with other rows.", "Not a direct measure of quality."],
    ["Evidence weight", "logistic function of popularity percentile", "How much trust the model gives the fan ratio based on the title having enough observed reach.", "Not a source confidence score or a human judgement."],
    ["Discovery score", "fan-ratio percentile × evidence weight", "The model's combined signal before it is converted into a reader-friendly percentile.", "Not the final rank by itself."],
    ["Fan Rank", "percentile of discovery score", "A 0–100 position among the rows in this snapshot.", "Not the same as 8/10 or a universal audience average."],
  ];
  addTable(sheet, metricRows, 5, 0, "FanRankMetricTable");
  setWidths(sheet, { A: 24, B: 30, C: 52, D: 48 });
  sheet.getRange("B6:B12").format.wrapText = true;
  sheet.getRange("C6:D12").format.wrapText = true;
  sheet.getRange("A6:D12").format.rowHeight = 42;

  styleSection(sheet, "A15:D15", "How to read the 0–100 scale");
  const anchorRows = [
    ["Fan Rank", "Relative anchor", "Useful interpretation", "Avoid saying"],
    ["50", "Middle of this dataset", "The title's combined signal is around the population midpoint.", "Average quality or 5/10."],
    ["70", "Above roughly 70% of rows", "A stronger-than-most discovery signal in this snapshot.", "70% of viewers liked it."],
    ["80", "Above roughly 80% of rows", "A high discovery signal, useful for a shortlist.", "An 8/10 audience score."],
    ["90", "Top roughly 10%", "A standout signal relative to this database.", "Guaranteed mainstream success."],
    ["95", "Top roughly 5%", "Very strong combination of reach and fan concentration.", "Universal critical quality."],
    ["99", "Top roughly 1%", "An exceptional relative discovery signal in this snapshot.", "A permanent global ranking."],
  ];
  addTable(sheet, anchorRows, 16, 0, "FanRankAnchorTable");
  sheet.getRange("C17:D22").format.wrapText = true;
  sheet.getRange("A17:D22").format.rowHeight = 34;

  styleSection(sheet, "F4:I4", "Examples from this snapshot");
  const exampleRows = [["Title", "Fan Rank", "Key components", "How to read it"]];
  for (const row of examples) {
    exampleRows.push([
      titleAndId(row),
      row.fanRank,
      `Popularity ${Number(row.popularity).toLocaleString()} | Favourite ratio ${row.fanPercent.toFixed(2)}% | Evidence weight ${row.evidenceWeight.toFixed(2)}`,
      row.exampleExplanation,
    ]);
  }
  addTable(sheet, exampleRows, 5, 5, "FanRankExampleTable");
  sheet.getRange("H6:I10").format.wrapText = true;
  sheet.getRange("F6:I10").format.rowHeight = 48;
  setWidths(sheet, { F: 34, G: 28, H: 48, I: 52 });
  sheet.getRange("G6:G10").format.numberFormat = "0.00";
  sheet.getRange("G6:G10").conditionalFormats.add("dataBar", { color: palette.teal });

  styleSection(sheet, "F15:I15", "Formula snapshot");
  const formulaRows = [
    ["Step", "Conceptual formula", "Why it exists", "Snapshot caveat"],
    ["1", "fanPercent = favourites / popularity × 100", "Normalises favourite counts by the title's observed reach.", "Both inputs come from AniList and reflect AniList users."],
    ["2", "evidenceWeight = logistic((popularityPercentile − 20) / 12)", "Reduces the chance that a tiny, noisy record wins only because of a high ratio.", "This is a model choice, not a proven law of fandom."],
    ["3", "discoveryScore = fanRatioPercentile × evidenceWeight", "Combines unusual fan concentration with evidence of enough reach.", "The score is relative to the collected population."],
    ["4", "fanRank = percentile(discoveryScore)", "Makes the result easier to compare on a 0–100 scale.", "Adding/removing rows can move a title's rank."],
  ];
  addTable(sheet, formulaRows, 16, 5, "FanRankFormulaTable");
  sheet.getRange("H17:I20").format.wrapText = true;
  sheet.getRange("F17:I20").format.rowHeight = 58;

  setBaseSheetStyle(sheet);
  sheet.getRange("A1:I1").format.font = { name: fontFamily, size: 15, bold: true, color: palette.navy };
  sheet.getRange("A5:D5").format.rowHeight = 30;
  sheet.getRange("A16:D16").format.rowHeight = 30;
  sheet.getRange("F5:I5").format.rowHeight = 30;
  sheet.getRange("F16:I16").format.rowHeight = 30;
  sheet.tabColor = palette.teal;
}

function buildOverview(sheet, payload, examples, deciles) {
  styleTitle(sheet, "A1", "Aeon Anime Fan Rank audit dataset");
  sheet.getRange("A2").values = [[`AniList anime with popularity ≥ ${payload.minPopularity}, all years included. Snapshot generated ${payload.generatedAt}.`]];
  sheet.getRange("A2:U2").merge();
  sheet.getRange("A2:U2").format = { font: { name: fontFamily, size: 10, italic: true, color: palette.muted } };

  styleSection(sheet, "A4:C4", "Collection snapshot");
  const summaryRows = [["Measure", "Value", "How to interpret it"], ...makeSummaryRows(payload)];
  addTable(sheet, summaryRows, 5, 0, "CollectionSnapshotTable");
  sheet.getRange("A6:C19").format.rowHeight = 34;
  sheet.getRange("C6:C19").format.wrapText = true;
  setWidths(sheet, { A: 28, B: 15, C: 54 });

  styleSection(sheet, "E4:H4", "The central idea");
  const ideaRows = [
    ["Question", "Answer", "Why it matters", "Example"],
    ["What is Fan Rank?", "A relative discovery signal, not a rating.", "It helps find titles whose fan concentration looks unusually strong for their observed reach.", "80 means above most rows here, not 8/10."],
    ["What is unique about it?", "It combines reach context with fan conversion.", "A title needs more than a large audience or a small noisy ratio alone.", "A huge title with weak fan concentration can rank below a smaller title with strong evidence."],
    ["What is its weak point?", "It inherits AniList behaviour and this dataset's boundaries.", "Popularity and favourites reflect one platform, and the rank changes when the population changes.", "Do not compare this snapshot to a future one without noting the date and cutoff."],
    ["What does it not use?", "Average score is shown but not part of Fan Rank.", "This keeps popularity, favourite behaviour, and rating opinions as separate signals.", "A high score does not automatically produce a high Fan Rank."],
  ];
  addTable(sheet, ideaRows, 5, 4, "FanRankIdeaTable");
  sheet.getRange("F6:H9").format.wrapText = true;
  sheet.getRange("E6:H9").format.rowHeight = 68;
  setWidths(sheet, { E: 24, F: 42, G: 48, H: 42 });

  styleSection(sheet, "J4:L4", "Filter views");
  const filterRows = [
    ["View", "Rows", "Use"],
    ["Strict BL/GL", payload.summary.blGlStrictExclude, "High precision automatic exclusion."],
    ["Broad BL/GL", payload.summary.blGlBroadExclude, "Discovery queue. Review before hiding."],
    ["BL/GL any signal", payload.summary.blGlNeedsReview, "Audit all related tags, including weak umbrella tags."],
    ["Hentai/adult", payload.summary.hentaiConfirmed, "Automatic exclusion from AniList adult evidence."],
    ["Ecchi", payload.summary.ecchiReview, "Separate signal. Do not equate with Hentai."],
    ["Dub reported", payload.summary.englishDubReported, "MyDubList reports an English dub."],
    ["Dub unknown", payload.summary.englishDubUnknownOrUnmapped, "Needs another source or manual check."],
  ];
  addTable(sheet, filterRows, 5, 9, "FilterViewTable");
  sheet.getRange("L6:L12").format.wrapText = true;
  sheet.getRange("J6:L12").format.rowHeight = 35;
  setWidths(sheet, { J: 23, K: 12, L: 38 });

  styleSection(sheet, "J14:L14", "Popularity discovery feeds");
  const feedRows = [
    ["Feed", "Rows", "Popularity rule"],
    ["Top 1%", payload.rows.filter((row) => Number(row.popularityPercentile) >= 99).length, "Popularity percentile ≥ 99"],
    ["Mainstream (Top 10%)", payload.rows.filter((row) => Number(row.popularityPercentile) >= 90 && Number(row.popularityPercentile) < 99).length, "90 ≤ percentile < 99"],
    ["Strong picks (Top 20%)", payload.rows.filter((row) => Number(row.popularityPercentile) >= 80 && Number(row.popularityPercentile) < 90).length, "80 ≤ percentile < 90"],
    ["Upcoming (Top 30%)", payload.rows.filter((row) => Number(row.popularityPercentile) >= 70 && Number(row.popularityPercentile) < 80).length, "70 ≤ percentile < 80"],
    ["All others", payload.rows.filter((row) => Number(row.popularityPercentile) < 70).length, "Popularity percentile < 70"],
  ];
  addTable(sheet, feedRows, 15, 9, "PopularityFeedTable");
  sheet.getRange("J16:L20").format.rowHeight = 28;
  sheet.getRange("L16:L20").format.wrapText = true;

  styleSection(sheet, "A22:H22", "Examples that show the model's boundaries");
  const exampleRows = [["Title", "Fan Rank", "Popularity", "Favourite ratio", "Evidence weight", "BL/GL view", "Dub view", "What this example shows"]];
  for (const row of examples) {
    exampleRows.push([
      titleAndId(row), row.fanRank, row.popularity, row.fanPercent, row.evidenceWeight,
      `${row.blGlStatus} | strict ${row.blGlStrictExclude ? "exclude" : "keep"}`,
      `${row.englishDubStatus} | ${row.englishDubConfidence}`,
      row.exampleExplanation,
    ]);
  }
  addTable(sheet, exampleRows, 23, 0, "BoundaryExampleTable");
  sheet.getRange("H24:H27").format.wrapText = true;
  sheet.getRange("A24:H27").format.rowHeight = 48;
  setWidths(sheet, { A: 32, B: 12, C: 15, D: 15, E: 15, F: 20, G: 20, H: 55 });
  sheet.getRange("B24:B27").format.numberFormat = "0.00";
  sheet.getRange("C24:C27").format.numberFormat = "#,##0";
  sheet.getRange("D24:E27").format.numberFormat = "0.00";
  setStatusFormatting(sheet, "F24:G27");

  styleSection(sheet, "J22:K22", "Fan Rank distribution");
  const decileRows = [["Fan Rank band", "Rows"], ...deciles.map((entry) => [entry.label, entry.count])];
  addTable(sheet, decileRows, 23, 9, "FanRankDecileTable");
  sheet.getRange("K24:K33").format.numberFormat = "#,##0";
  const columnChart = sheet.charts.add("bar", sheet.getRange("J23:K33"));
  columnChart.title = "Rows by Fan Rank band";
  columnChart.titleTextStyle.fontSize = 12;
  columnChart.titleTextStyle.typeface = fontFamily;
  columnChart.hasLegend = false;
  columnChart.xAxis = { axisType: "textAxis", textStyle: { typeface: fontFamily, fontSize: 9 } };
  columnChart.yAxis = { numberFormatCode: "#,##0", numberFormatSourceLinked: false, textStyle: { typeface: fontFamily, fontSize: 9 } };
  columnChart.setPosition("M22", "U37");

  styleSection(sheet, "X1:Y1", "Chart data");
  sheet.getRange("X2:Y2").values = [["log10 popularity", "Fan Rank"]];
  const scatterRows = payload.rows.filter((row) => row.fanRank != null && row.popularity > 0).filter((_, index) => index % Math.max(1, Math.floor(payload.rows.length / 160)) === 0).slice(0, 160);
  sheet.getRange(`X3:Y${2 + scatterRows.length}`).values = scatterRows.map((row) => [Math.log10(Math.max(row.popularity, 1)), row.fanRank]);
  sheet.getRange(`X2:Y${2 + scatterRows.length}`).format.font = { name: fontFamily, size: 8, color: palette.muted };
  sheet.getRange(`X3:X${2 + scatterRows.length}`).format.numberFormat = "0.00";
  sheet.getRange(`Y3:Y${2 + scatterRows.length}`).format.numberFormat = "0.00";
  const scatterChart = sheet.charts.add("scatter", sheet.getRange(`X2:Y${2 + scatterRows.length}`));
  scatterChart.title = "Reach context and Fan Rank";
  scatterChart.titleTextStyle.fontSize = 12;
  scatterChart.titleTextStyle.typeface = fontFamily;
  scatterChart.hasLegend = false;
  scatterChart.xAxis = { axisType: "valueAxis", title: { text: "log10 AniList popularity" }, numberFormatCode: "0.0", numberFormatSourceLinked: false, textStyle: { typeface: fontFamily, fontSize: 9 } };
  scatterChart.yAxis = { axisType: "valueAxis", title: { text: "Fan Rank" }, numberFormatCode: "0", numberFormatSourceLinked: false, textStyle: { typeface: fontFamily, fontSize: 9 } };
  scatterChart.setPosition("M39", "U55");

  setBaseSheetStyle(sheet);
  sheet.getRange("A1:U1").format.font = { name: fontFamily, size: 15, bold: true, color: palette.navy };
  sheet.tabColor = palette.navy;
}

function buildSources(sheet, payload) {
  styleTitle(sheet, "A1", "Sources, method notes, and limitations");
  sheet.getRange("A2").values = [["The dataset keeps source evidence with each derived decision so future refreshes can be compared instead of silently replacing judgement with a new label."]];
  sheet.getRange("A2:F2").merge();
  sheet.getRange("A2:F2").format = { font: { name: fontFamily, size: 10, italic: true, color: palette.muted }, wrapText: true };
  sheet.getRange("A2:F2").format.rowHeight = 30;

  styleSection(sheet, "A4:F4", "Source register");
  const sourceRows = [
    ["Source", "Role", "URL", "License / attribution", "What we use", "Material limitation"],
    ["AniList GraphQL API", "Primary anime catalogue and Fan Rank inputs", payload.sourceUrl, "Use according to AniList terms and API policy.", "IDs, titles, dates, popularity, favourites, scores, genres, tags, tag rank, external links.", "Popularity and favourites are AniList-platform measures. Tag rank is relevance, not truth probability."],
    ["AniList MediaTag documentation", "Field interpretation", "https://docs.anilist.co/reference/object/mediatag", "Official documentation.", "Category, rank, and spoiler fields for tag evidence.", "A high rank means the tag is more relevant to the title, not that the title belongs to the genre with certainty."],
    ["Bocchi the Rock! AniList record", "Known false-positive example", "https://anilist.co/anime/130003/BOCCHI-THE-ROCK/", "AniList record.", "Shows why Yuri alone is a review signal rather than strict exclusion.", "This is an example, not an external classifier."],
    ["given AniList record", "Known positive evidence example", "https://anilist.co/anime/108430/Given/stats", "AniList record.", "Shows Boys' Love plus LGBTQ+ supporting tags at high relevance.", "Still retain source evidence and allow review."],
    ["MyDubList", "English-dub evidence join", "https://github.com/Joelis57/MyDubList", "CC BY 4.0. Dub data © MyDubList - https://mydublist.com - (CC BY 4.0)", "AniList-to-MAL mappings, English confidence tiers, partial records and source counts.", "No record means unknown coverage, not proof that no English dub exists."],
  ];
  addTable(sheet, sourceRows, 5, 0, "SourceRegisterTable");
  sheet.getRange("C6:F10").format.wrapText = true;
  sheet.getRange("A6:F10").format.rowHeight = 58;
  setWidths(sheet, { A: 28, B: 32, C: 48, D: 44, E: 60, F: 62 });

  styleSection(sheet, "A13:F13", "Collection and scoring decisions");
  const decisionRows = [
    ["Decision", "Current implementation", "Why", "Change risk", "Where to inspect", "Next improvement"],
    ["Coverage", "All years. Popularity ≥ 1,000. Query ranges partitioned at AniList's result boundary.", "Avoids losing older anime or the middle of a broad query.", "Ranks change if the cutoff or population changes.", "Overview and Anime data.", "Record the snapshot date and refresh comparisons."],
    ["Fan Rank", "Favourite ratio, log popularity percentile, evidence weight, discovery score, final percentile.", "Balances fan concentration with enough observed reach.", "It reflects AniList behaviour and model choices.", "Fan Rank guide and Anime data.", "Back-test against discovery outcomes or user actions."],
    ["BL/GL strict", "Direct genre or high-ranked explicit tag plus independent support.", "High precision and avoids Yuri-only false positives.", "May miss a real title if AniList evidence is weak or absent.", "Content review and Anime data.", "Add a second-source agreement layer, not a single replacement source."],
    ["BL/GL broad", "All likely rows, including medium-confidence explicit or umbrella tags.", "Useful for discovery and manual review.", "False positives are expected.", "Content review.", "Let reviewers record an override with source and date."],
    ["English dub", "AniList IDs mapped to all available MAL IDs, then checked against MyDubList confidence and partial files.", "MyDubList is a practical availability tracker rather than a title-language guess.", "Coverage gaps and partial data remain.", "Dub audit.", "Add a second dub source only where MyDubList is unknown or disputed."],
  ];
  addTable(sheet, decisionRows, 14, 0, "MethodDecisionTable");
  sheet.getRange("B15:F19").format.wrapText = true;
  sheet.getRange("A15:F19").format.rowHeight = 66;

  styleSection(sheet, "A22:F22", "Refresh checklist");
  const refreshRows = [
    ["Step", "Check", "Pass condition", "Why it matters"],
    ["1", "AniList query coverage", "No unresolved range or overloaded exact popularity bucket.", "The 5,000-result browse cap must not silently drop rows."],
    ["2", "Title coverage", "Missing English titles remain flagged, never invented.", "Display language should not become fabricated data."],
    ["3", "Fan Rank comparability", "Cutoff, row count, and snapshot date are recorded.", "A relative rank needs a stable reference population."],
    ["4", "BL/GL review", "Strict and broad counts are checked against known examples.", "Umbrella tags can create false positives."],
    ["5", "Dub coverage", "Reported, partial, and unknown are kept distinct.", "A missing external record is not a negative answer."],
  ];
  addTable(sheet, refreshRows, 23, 0, "RefreshChecklistTable");
  sheet.getRange("B24:D28").format.wrapText = true;
  sheet.getRange("A24:D28").format.rowHeight = 42;
  setWidths(sheet, { A: 12, B: 42, C: 62, D: 54 });
  setBaseSheetStyle(sheet);
  sheet.getRange("A1:F1").format.font = { name: fontFamily, size: 15, bold: true, color: palette.navy };
  sheet.tabColor = palette.muted;
}

function buildDiscoveryFeed(sheet, definition, sourceRows) {
  const rows = sourceRows.filter((row) => definition.predicate(Number(row.popularityPercentile))).sort((a, b) => Number(b.fanRank) - Number(a.fanRank) || Number(b.popularity) - Number(a.popularity) || shortTitle(a).localeCompare(shortTitle(b)));
  const title = definition.sheetName;
  styleTitle(sheet, "A1", title);
  sheet.getRange("A2").values = [[`${definition.description} Popularity decides the feed. Fan Rank sorts titles inside it. Each title appears in one feed only, while the raw catalogue and all filter signals remain available in the Anime data sheet.`]];
  sheet.getRange("A2:R2").merge();
  sheet.getRange("A2:R2").format = { font: { name: fontFamily, size: 10, italic: true, color: palette.muted }, wrapText: true };
  sheet.getRange("A2:R2").format.rowHeight = 30;
  sheet.getRange("A3:B3").values = [["Rows in this feed", rows.length]];
  sheet.getRange("A3:B3").format = { fill: palette.navyLight, font: { name: fontFamily, size: 10, bold: true, color: palette.navy } };
  sheet.getRange("D3:R3").values = [["Use the table filters to hide adult content, BL/GL review rows, or unknown dub coverage. Fan Rank is already sorted highest first."]];
  sheet.getRange("D3:R3").merge();
  sheet.getRange("D3:R3").format = { font: { name: fontFamily, size: 9, italic: true, color: palette.muted }, wrapText: true };

  const columns = [
    ["Feed position", (_, index) => index + 1],
    ["AniList ID", (row) => row.anilistId],
    ["Title", shortTitle],
    ["Fan Rank", (row) => valueOrNull(row.fanRank)],
    ["Popularity percentile", (row) => valueOrNull(row.popularityPercentile)],
    ["Popularity", (row) => valueOrNull(row.popularity)],
    ["Favourites", (row) => valueOrNull(row.favourites)],
    ["Favourite ratio %", (row) => valueOrNull(row.fanPercent)],
    ["Average score", (row) => valueOrNull(row.averageScore)],
    ["Format", (row) => valueOrNull(row.format)],
    ["Season year", (row) => valueOrNull(row.seasonYear)],
    ["BL/GL view", (row) => `${row.blGlStatus} | strict ${row.blGlStrictExclude ? "exclude" : "keep"}`],
    ["Hentai status", (row) => valueOrNull(row.hentaiStatus)],
    ["English dub", (row) => valueOrNull(row.englishDubStatus)],
    ["Dub confidence", (row) => valueOrNull(row.englishDubConfidence)],
    ["English title status", (row) => valueOrNull(row.titleEnglishStatus)],
    ["Key tags", (row) => valueOrNull(row.tags)],
    ["AniList URL", (row) => valueOrNull(row.anilistUrl)],
  ];
  const values = [columns.map(([header]) => header), ...rows.map((row, index) => columns.map(([, getter]) => getter(row, index)))];
  addTable(sheet, values, 4, 0, definition.tableName);
  sheet.freezePanes.freezeRows(4);
  sheet.freezePanes.freezeColumns(3);
  setWidths(sheet, { A: 13, B: 11, C: 36, D: 12, E: 20, F: 15, G: 13, H: 16, I: 14, J: 14, K: 12, L: 23, M: 20, N: 18, O: 18, P: 23, Q: 62, R: 52 });
  const lastRow = values.length + 3;
  sheet.getRange(`D5:D${lastRow}`).format.numberFormat = "0.00";
  sheet.getRange(`E5:E${lastRow}`).format.numberFormat = "0.00";
  sheet.getRange(`F5:G${lastRow}`).format.numberFormat = "#,##0";
  sheet.getRange(`H5:I${lastRow}`).format.numberFormat = "0.00";
  sheet.getRange(`Q5:Q${lastRow}`).format.wrapText = false;
  sheet.getRange(`D5:D${lastRow}`).conditionalFormats.add("dataBar", { color: palette.teal });
  setStatusFormatting(sheet, `L5:O${lastRow}`);
  setBaseSheetStyle(sheet);
  sheet.getRange("A1:R1").format.font = { name: fontFamily, size: 15, bold: true, color: palette.navy };
  sheet.tabColor = definition.tabColor;
  return { rows, rowCount: rows.length };
}

const payload = JSON.parse(await fs.readFile(inputFile, "utf8"));
const rows = payload.rows;
const rowById = new Map(rows.map((row) => [Number(row.anilistId), row]));

const examples = [
  { id: 16498, explanation: "High reach and strong fan concentration. This is a relative discovery signal, not a claim that it is the best anime." },
  { id: 130003, explanation: "A Yuri tag is present, but it is lower-ranked and unsupported. The strict BL/GL view keeps it visible, which prevents a Bocchi-style false positive." },
  { id: 108430, explanation: "A high-ranked Boys' Love tag is reinforced by LGBTQ+ Themes and Bisexual tags. It lands in the strict BL/GL exclusion view, while the raw row remains available." },
  { id: 978, explanation: "An older, less-popular title can still score highly when its favourite ratio is unusually strong and its reach is large enough for the evidence weight to remain high." },
].map((entry) => ({ ...rowById.get(entry.id), exampleExplanation: entry.explanation })).filter((row) => row?.anilistId);

const decileCounts = Array.from({ length: 10 }, (_, index) => ({ label: `${index * 10}–${index === 9 ? 100 : index * 10 + 10}`, count: 0 }));
for (const row of rows) {
  if (row.fanRank == null) continue;
  const index = Math.min(9, Math.floor(Number(row.fanRank) / 10));
  decileCounts[index].count += 1;
}

const workbook = Workbook.create();
const overview = workbook.worksheets.add("Overview");
const guide = workbook.worksheets.add("Fan Rank guide");
const animeData = workbook.worksheets.add("Anime data");
const contentReview = workbook.worksheets.add("Content review");
const dubAudit = workbook.worksheets.add("Dub audit");
const sources = workbook.worksheets.add("Sources");

buildOverview(overview, payload, examples, decileCounts);
buildFanRankGuide(guide, payload, examples);

const animeColumns = [
  ["AniList ID", (row) => row.anilistId],
  ["English title", (row) => valueOrNull(row.titleEnglish)],
  ["Display title", (row) => valueOrNull(row.titleDisplay)],
  ["Romaji title", (row) => valueOrNull(row.titleRomaji)],
  ["Native title", (row) => valueOrNull(row.titleNative)],
  ["English title status", (row) => row.titleEnglishStatus],
  ["Format", (row) => valueOrNull(row.format)],
  ["Status", (row) => valueOrNull(row.status)],
  ["Start date", (row) => asDate(row.startDate)],
  ["End date", (row) => asDate(row.endDate)],
  ["Season year", (row) => valueOrNull(row.seasonYear)],
  ["Episodes", (row) => valueOrNull(row.episodes)],
  ["Duration minutes", (row) => valueOrNull(row.durationMinutes)],
  ["Country", (row) => valueOrNull(row.countryOfOrigin)],
  ["Source", (row) => valueOrNull(row.source)],
  ["AniList adult flag", (row) => displayBool(row.isAdult)],
  ["Genres", (row) => valueOrNull(row.genres)],
  ["AniList tags with category and rank", (row) => valueOrNull(row.tags)],
  ["Average score", (row) => valueOrNull(row.averageScore)],
  ["Mean score", (row) => valueOrNull(row.meanScore)],
  ["Popularity", (row) => valueOrNull(row.popularity)],
  ["Favourites", (row) => valueOrNull(row.favourites)],
  ["Favourite ratio %", (row) => valueOrNull(row.fanPercent)],
  ["Popularity percentile", (row) => valueOrNull(row.popularityPercentile)],
  ["Fan-ratio percentile", (row) => valueOrNull(row.fanRatioPercentile)],
  ["Evidence weight", (row) => valueOrNull(row.evidenceWeight)],
  ["Discovery score", (row) => valueOrNull(row.discoveryScore)],
  ["Fan Rank", (row) => valueOrNull(row.fanRank)],
  ["BL/GL status", (row) => valueOrNull(row.blGlStatus)],
  ["BL/GL confidence", (row) => valueOrNull(row.blGlConfidence)],
  ["BL/GL strict exclude", (row) => displayBool(row.blGlStrictExclude)],
  ["BL/GL broad review", (row) => displayBool(row.blGlBroadExclude)],
  ["BL/GL needs review", (row) => displayBool(row.blGlNeedsReview)],
  ["BL/GL type", (row) => valueOrNull(row.blGlType)],
  ["BL/GL highest evidence rank", (row) => valueOrNull(row.blGlHighestEvidenceRank)],
  ["BL/GL evidence", (row) => valueOrNull(row.blGlEvidence)],
  ["BL/GL supporting evidence", (row) => valueOrNull(row.blGlSupportingEvidence)],
  ["BL/GL reason", (row) => valueOrNull(row.blGlReason)],
  ["Hentai status", (row) => valueOrNull(row.hentaiStatus)],
  ["Hentai action", (row) => valueOrNull(row.hentaiRecommendedAction)],
  ["Hentai evidence", (row) => valueOrNull(row.hentaiEvidence)],
  ["English dub status", (row) => valueOrNull(row.englishDubStatus)],
  ["English dub confidence", (row) => valueOrNull(row.englishDubConfidence)],
  ["English dub available", (row) => displayBool(row.englishDubAvailable)],
  ["English dub source count", (row) => valueOrNull(row.englishDubSourceCount)],
  ["Mapped MAL IDs", (row) => valueOrNull(row.mappedMalIds)],
  ["English dub evidence", (row) => valueOrNull(row.englishDubEvidence)],
  ["AniList URL", (row) => valueOrNull(row.anilistUrl)],
  ["ANN link", (row) => valueOrNull(row.annLink)],
  ["AniDB link", (row) => valueOrNull(row.anidbLink)],
];
const animeValues = [animeColumns.map(([header]) => header), ...rows.map((row) => animeColumns.map(([, getter]) => getter(row)))];
addTable(animeData, animeValues, 1, 0, "AnimeDataTable");
animeData.freezePanes.freezeRows(1);
animeData.freezePanes.freezeColumns(2);
setWidths(animeData, {
  A: 11, B: 30, C: 30, D: 30, E: 22, F: 22, G: 14, H: 15, I: 13, J: 13, K: 11, L: 10, M: 14, N: 10, O: 18, P: 14, Q: 26, R: 62, S: 12, T: 12, U: 13, V: 13, W: 15, X: 16, Y: 16, Z: 14, AA: 16, AB: 12, AC: 14, AD: 16, AE: 16, AF: 16, AG: 14, AH: 16, AI: 44, AJ: 44, AK: 60, AL: 18, AM: 16, AN: 18, AO: 16, AP: 18, AQ: 15, AR: 48, AS: 38, AT: 38, AU: 38, AV: 38,
});
const animeLastRow = animeValues.length;
for (const column of ["I", "J"]) animeData.getRange(`${column}2:${column}${animeLastRow}`).format.numberFormat = "yyyy-mm-dd";
for (const column of ["S", "T"]) animeData.getRange(`${column}2:${column}${animeLastRow}`).format.numberFormat = "0.0";
for (const column of ["U", "V"]) animeData.getRange(`${column}2:${column}${animeLastRow}`).format.numberFormat = "#,##0";
for (const column of ["W", "X", "Y", "Z", "AA", "AB", "AH"]) animeData.getRange(`${column}2:${column}${animeLastRow}`).format.numberFormat = "0.00";
animeData.getRange(`AB2:AB${animeLastRow}`).conditionalFormats.add("dataBar", { color: palette.teal });
animeData.getRange(`AC2:AC${animeLastRow}`).conditionalFormats.add("containsText", { text: "likely", format: { fill: palette.amberLight, font: { color: palette.amber, bold: true } } });
animeData.getRange(`AC2:AC${animeLastRow}`).conditionalFormats.add("containsText", { text: "review", format: { fill: palette.amberLight, font: { color: palette.amber } } });
animeData.getRange(`AL2:AL${animeLastRow}`).conditionalFormats.add("containsText", { text: "confirmed", format: { fill: palette.redLight, font: { color: palette.red, bold: true } } });
animeData.getRange(`AO2:AO${animeLastRow}`).conditionalFormats.add("containsText", { text: "reported", format: { fill: palette.greenLight, font: { color: palette.green } } });
animeData.getRange(`AO2:AO${animeLastRow}`).conditionalFormats.add("containsText", { text: "partial", format: { fill: palette.amberLight, font: { color: palette.amber } } });
animeData.showGridLines = false;
animeData.tabColor = palette.slateLight;

const contentRows = rows.filter((row) => row.blGlNeedsReview || row.hentaiStatus !== "keep");
const contentColumns = [
  ["AniList ID", (row) => row.anilistId],
  ["Title", shortTitle],
  ["Format", (row) => valueOrNull(row.format)],
  ["Start date", (row) => asDate(row.startDate)],
  ["Popularity", (row) => valueOrNull(row.popularity)],
  ["Fan Rank", (row) => valueOrNull(row.fanRank)],
  ["Genres", (row) => valueOrNull(row.genres)],
  ["Tags with category and rank", (row) => valueOrNull(row.tags)],
  ["BL/GL status", (row) => valueOrNull(row.blGlStatus)],
  ["BL/GL confidence", (row) => valueOrNull(row.blGlConfidence)],
  ["BL/GL strict exclude", (row) => displayBool(row.blGlStrictExclude)],
  ["BL/GL broad review", (row) => displayBool(row.blGlBroadExclude)],
  ["BL/GL type", (row) => valueOrNull(row.blGlType)],
  ["BL/GL evidence", (row) => valueOrNull(row.blGlEvidence)],
  ["BL/GL supporting evidence", (row) => valueOrNull(row.blGlSupportingEvidence)],
  ["BL/GL reason", (row) => valueOrNull(row.blGlReason)],
  ["Hentai status", (row) => valueOrNull(row.hentaiStatus)],
  ["Hentai action", (row) => valueOrNull(row.hentaiRecommendedAction)],
  ["Hentai evidence", (row) => valueOrNull(row.hentaiEvidence)],
  ["AniList adult flag", (row) => displayBool(row.isAdult)],
  ["AniList URL", (row) => valueOrNull(row.anilistUrl)],
];
const contentValues = [contentColumns.map(([header]) => header), ...contentRows.map((row) => contentColumns.map(([, getter]) => getter(row)))];
addTable(contentReview, contentValues, 1, 0, "ContentReviewTable");
contentReview.freezePanes.freezeRows(1);
contentReview.freezePanes.freezeColumns(2);
setWidths(contentReview, { A: 11, B: 32, C: 14, D: 13, E: 14, F: 12, G: 26, H: 64, I: 15, J: 15, K: 17, L: 17, M: 14, N: 42, O: 46, P: 58, Q: 20, R: 17, S: 36, T: 18, U: 44 });
contentReview.getRange(`D2:D${contentValues.length}`).format.numberFormat = "yyyy-mm-dd";
contentReview.getRange(`E2:F${contentValues.length}`).format.numberFormat = "#,##0.00";
setStatusFormatting(contentReview, `I2:I${contentValues.length}`);
setStatusFormatting(contentReview, `Q2:R${contentValues.length}`);
contentReview.showGridLines = false;
contentReview.tabColor = palette.amber;

const dubRows = [...rows].sort((a, b) => {
  const statusOrder = { reported: 0, partial: 1, "not listed": 2, unmapped: 3 };
  return (statusOrder[a.englishDubStatus] ?? 9) - (statusOrder[b.englishDubStatus] ?? 9) || shortTitle(a).localeCompare(shortTitle(b));
});
const dubColumns = [
  ["AniList ID", (row) => row.anilistId],
  ["Title", shortTitle],
  ["Format", (row) => valueOrNull(row.format)],
  ["Start date", (row) => asDate(row.startDate)],
  ["Popularity", (row) => valueOrNull(row.popularity)],
  ["Fan Rank", (row) => valueOrNull(row.fanRank)],
  ["Mapped MAL IDs", (row) => valueOrNull(row.mappedMalIds)],
  ["English dub status", (row) => valueOrNull(row.englishDubStatus)],
  ["English dub confidence", (row) => valueOrNull(row.englishDubConfidence)],
  ["English dub available", (row) => displayBool(row.englishDubAvailable)],
  ["Source count", (row) => valueOrNull(row.englishDubSourceCount)],
  ["Evidence", (row) => valueOrNull(row.englishDubEvidence)],
  ["AniList URL", (row) => valueOrNull(row.anilistUrl)],
];
const dubValues = [dubColumns.map(([header]) => header), ...dubRows.map((row) => dubColumns.map(([, getter]) => getter(row)))];
addTable(dubAudit, dubValues, 1, 0, "DubAuditTable");
dubAudit.freezePanes.freezeRows(1);
dubAudit.freezePanes.freezeColumns(2);
setWidths(dubAudit, { A: 11, B: 34, C: 14, D: 13, E: 14, F: 12, G: 18, H: 20, I: 20, J: 18, K: 13, L: 58, M: 52 });
dubAudit.getRange(`D2:D${dubValues.length}`).format.numberFormat = "yyyy-mm-dd";
dubAudit.getRange(`E2:F${dubValues.length}`).format.numberFormat = "#,##0.00";
setStatusFormatting(dubAudit, `H2:I${dubValues.length}`);
dubAudit.showGridLines = false;
dubAudit.tabColor = palette.teal;

buildSources(sources, payload);

const feedDefinitions = [
  {
    sheetName: "Top 1%",
    description: "The most popular 1% of the catalogue by AniList popularity percentile (99–100).",
    predicate: (percentile) => percentile >= 99,
    tableName: "Top1PopularityFeedTable",
    tabColor: palette.navy,
  },
  {
    sheetName: "Mainstream (Top 10%)",
    description: "The rest of the top 10% popularity band (90–<99). It excludes the Top 1% sheet so feeds do not overlap.",
    predicate: (percentile) => percentile >= 90 && percentile < 99,
    tableName: "MainstreamPopularityFeedTable",
    tabColor: "#416E9B",
  },
  {
    sheetName: "Strong picks (Top 20%)",
    description: "The top 20% popularity band below Mainstream (80–<90). Fan Rank is used to order the titles inside the band.",
    predicate: (percentile) => percentile >= 80 && percentile < 90,
    tableName: "StrongPicksPopularityFeedTable",
    tabColor: "#5B8DB8",
  },
  {
    sheetName: "Upcoming (Top 30%)",
    description: "The top 30% popularity band below Strong picks (70–<80). This is the practical discovery and upcoming layer.",
    predicate: (percentile) => percentile >= 70 && percentile < 80,
    tableName: "UpcomingPopularityFeedTable",
    tabColor: palette.teal,
  },
  {
    sheetName: "All others",
    description: "Titles below the top 30% popularity boundary (below 70). This long tail is still sorted by Fan Rank for discovery.",
    predicate: (percentile) => percentile < 70,
    tableName: "AllOthersPopularityFeedTable",
    tabColor: palette.muted,
  },
];
const feedResults = [];
for (const definition of feedDefinitions) {
  const sheet = workbook.worksheets.add(definition.sheetName);
  feedResults.push({ definition, ...buildDiscoveryFeed(sheet, definition, rows) });
}

workbook.recalculate();

const checks = [];
checks.push(await workbook.inspect({ kind: "table", range: "Overview!A1:U55", include: "values,formulas", tableMaxRows: 18, tableMaxCols: 12, maxChars: 14000 }));
checks.push(await workbook.inspect({ kind: "table", range: "Fan Rank guide!A1:I22", include: "values,formulas", tableMaxRows: 22, tableMaxCols: 9, maxChars: 16000 }));
checks.push(await workbook.inspect({ kind: "table", range: "Anime data!A1:AV8", include: "values,formulas", tableMaxRows: 8, tableMaxCols: 48, maxChars: 18000 }));
checks.push(await workbook.inspect({ kind: "table", range: "Top 1%!A1:R12", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 18, maxChars: 12000 }));
checks.push(await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" }));
console.log(checks.map((check) => check.ndjson).join("\n"));

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(renderDir, { recursive: true });
const renderTargets = [
  ["Overview", "A1:U55"],
  ["Fan Rank guide", "A1:I22"],
  ["Anime data", "A1:AV8"],
  ["Content review", "A1:U30"],
  ["Dub audit", "A1:M24"],
  ["Sources", "A1:F28"],
  ...feedDefinitions.map((definition) => [definition.sheetName, "A1:R24"]),
];
for (const [sheetName, range] of renderTargets) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(path.join(renderDir, `${sheetName.replaceAll(" ", "-").replaceAll("%", "pct").replaceAll("(", "").replaceAll(")", "")}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({
  outputPath,
  renderDir,
  rows: rows.length,
  contentReviewRows: contentRows.length,
  dubRows: dubRows.length,
  feeds: feedResults.map(({ definition, rowCount }) => ({ name: definition.sheetName, rowCount })),
}, null, 2));
