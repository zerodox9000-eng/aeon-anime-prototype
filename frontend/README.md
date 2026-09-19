# Local Aeon Anime frontend shell

This directory is a local copy of the current Aeon frontend so the mobile and desktop layout can be inspected without touching the live manhwa repository.

It has been renamed and its app metadata now says Anime. It loads the bundled AniList snapshot in `public/anime-data`, using AniList cover links, AniList genres and MediaTag categories, per-title AniList tag relevance evidence, AniList statistics, and the derived Fan Rank fields. The same bundle is published by the repository's GitHub Pages workflow for the private prototype site.

Run from this directory after installing dependencies:

```text
npm run dev
```

The Pages build sets `VITE_BASE_PATH=/aeon-anime-prototype/`; local development leaves that variable unset and runs at the root path.
