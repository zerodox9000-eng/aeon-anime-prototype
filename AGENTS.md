# Aeon Anime Prototype Contract

This repository is the local anime prototype. It is separate from the existing
manhwa frontend and backend repositories.

## Data contract

- AniList is the primary catalogue and Fan Rank population source.
- The initial collection includes all years and uses a popularity cutoff, not a
  year cutoff. AniList page limits are handled by partitioning query ranges.
- Raw AniList rows must remain available. BL/GL, adult-content, and English-dub
  decisions are derived views and must not delete source records.
- AniList descriptions and non-disabled external links are preserved when
  available. The frontend displays AniList STREAMING links as watching links;
  missing descriptions or providers remain explicit unknowns.
- AniList staff credits are preserved separately from the visible creator line;
  creator names prefer explicit original creator/story/work roles and retain
  the source role evidence instead of relabeling directors as creators.
- AniList cover URLs and cover accent colors are preserved separately; feed
  headers may use the accent colors from the first three visible covers.
- Every derived decision should retain its evidence, confidence, and source.
- A missing external-source record means unknown coverage unless the source
  explicitly provides a negative value.
- The feed-level English dub-only filter includes only `reported` and `partial`
  MyDubList evidence (`english_dub.available === true`). `not listed`,
  `unmapped`, and missing records remain unknown and are excluded when the
  filter is enabled.
- Feed format filters store AniList format values such as `TV`, `TV_SHORT`,
  `MOVIE`, `SPECIAL`, `OVA`, `ONA`, and `MUSIC`. Multiple values use OR logic;
  an empty selection means all formats.

## Source and attribution rules

- Preserve source URLs and retrieval timestamps for durable exports.
- MyDubList-derived dub data requires CC BY 4.0 attribution and must retain its
  stated coverage caveat.
- Do not invent English titles, dub status, or content classifications.

## Working rules

- Keep the prototype mobile-safe when frontend work begins.
- `frontend/` is a local shell copied from the manhwa frontend and adapted to the local AniList export. It must remain separate from the pipeline under `scripts/` and `data/`. AniList MediaTag relevance ranks and category paths must not be translated into the manhwa tag-weight taxonomy.
- Do not push or deploy without explicit user approval. The approved prototype deployment uses the separate private `aeon-anime-prototype` repository and the GitHub Pages workflow under `.github/workflows/`.
- `frontend/vite.config.ts` uses `VITE_BASE_PATH` for the GitHub Pages subpath; local development keeps the root path when the variable is absent.
- Inspect generated spreadsheets and visual artifacts before handing them off.
