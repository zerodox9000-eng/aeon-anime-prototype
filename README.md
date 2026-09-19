# Aeon Anime prototype

This is the local anime counterpart to the Aeon manhwa project. It keeps the catalogue, scoring work, and derived filters separate from the frontend shell so each decision remains inspectable.

## Prototype site

[Open the Aeon Anime prototype on GitHub Pages](https://zerodox9000-eng.github.io/aeon-anime-prototype/)

The site is published from this private repository by GitHub Actions. It is a playground for reviewing the catalogue and feed behavior, and is independent of the live manhwa app. A new deployment can take a minute or two after a push to `master`.

## Current snapshot

- Primary catalogue: AniList GraphQL API
- Coverage: all years
- Cutoff: AniList popularity at least 1,000
- Collection: popularity-range queries are partitioned around AniList's 5,000-result browse limit, then deduplicated by AniList ID
- Fan Rank: favourite ratio, reach percentile, evidence weight, discovery score, and final percentile
- Content views: raw rows remain available; BL/GL, adult, ecchi, and English-dub status are derived with evidence
- English-dub source: MyDubList joined through AniList-to-MAL mappings, with CC BY 4.0 attribution retained
- English-dub filter: includes only MyDubList `reported` and `partial` evidence; `not listed`, `unmapped`, and missing records remain unknown and are not included in an English-dub-only feed

## Main files

- `scripts/collect-anilist-anime.mjs`: collect the AniList catalogue and calculate Fan Rank
- `scripts/derive-content-filters.mjs`: add auditable BL/GL and adult-content views
- `scripts/enrich-mydublist.mjs`: join MyDubList English-dub evidence
- `scripts/build-anime-audit-workbook.mjs`: create the review workbook and discovery feeds
- `data/anime-anilist-prototype-final.json`: current enriched snapshot
- `frontend/`: local copy of the current Aeon frontend shell, adapted to load the local AniList anime export; it remains separate from the manhwa frontend and does not point at GitHub-hosted data

The workbook's popularity feeds are exclusive bands. Popularity decides the sheet, and Fan Rank sorts titles inside it:

- Top 1%: popularity percentile at least 99
- Mainstream (Top 10%): 90 to below 99
- Strong picks (Top 20%): 80 to below 90
- Upcoming (Top 30%): 70 to below 80
- All others: below 70

This avoids overlapping feeds while keeping the threshold visible to readers.

## English-dub evidence

The English-dub filter is intentionally evidence-led:

- `reported`: MyDubList has a positive English-dub record for a mapped title.
- `partial`: MyDubList marks at least one mapped entry as only partially dubbed.
- `not listed`: a reliable AniList-to-MAL mapping exists, but the current MyDubList English confidence files have no positive record.
- `unmapped`: no reliable AniList-to-MAL mapping was available.

Only `reported` and `partial` are included by an English-dub-only feed. The other states are unknown coverage, not proof that no dub exists.

Feed format filters use AniList's own formats and allow multiple selections. Leaving all formats unselected means all formats.

The local frontend export is rebuilt with `scripts/build-anime-frontend-export.mjs`. It preserves AniList MediaTag IDs, category paths, and each title's relevance rank as AniList-specific evidence. It does not reinterpret those ranks as the manhwa app's core/defining/recurrent/incidental tag weights. Episode counts are displayed as episodes, and the current snapshot includes a single dated baseline for the shared history contract rather than pretending to have a time series.
