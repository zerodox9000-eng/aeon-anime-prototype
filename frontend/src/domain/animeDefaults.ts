import type { Feed, FeedFilters, FeedSegment, FeedViewSettings, MetricRange, VisibleTitleFields } from "./types";
import { TAG_WEIGHT_TYPES } from "./types";

const CREATED_AT = "2026-09-19T00:00:00.000Z";

const visible: VisibleTitleFields = {
  cover: true,
  title: true,
  rank: true,
  genreChips: true,
  status: false,
  year: true,
  chapters: false,
  contentRating: false,
  popularity: true,
  favourites: true,
  meanScore: false,
  fanFavouriteRatio: false,
  discoveryScore: false,
  growthDelta: false,
  labels: false,
  sourceBadges: false,
  quickActions: false,
  description: false,
  links: false,
};

const view: FeedViewSettings = {
  mode: "grid",
  gridColumns: 3,
  desktopGridColumns: 6,
  gridDensity: "standard",
  listCoverSize: "medium",
  listDensity: "standard",
  metricSlots: ["fanFavouriteDiscoveryPercentile"],
  visible,
};

function filters(metricRange: MetricRange): FeedFilters {
  return {
    sourceMode: "anilist",
    sourceModes: ["anilist"],
    query: "",
    includeTagIds: [],
    excludeTagIds: [],
    tagMatch: "any",
    tagWeightTypes: [...TAG_WEIGHT_TYPES],
    contentRatings: ["safe", "suggestive"],
    statuses: [],
    formats: [],
    minChapters: null,
    maxChapters: null,
    minYear: null,
    maxYear: null,
    minPopularity: null,
    maxPopularity: null,
    minFavourites: null,
    maxFavourites: null,
    minMeanScore: null,
    maxMeanScore: null,
    metricRanges: [metricRange],
    includeEstimatedDates: true,
    requireOfficialEnglishLink: false,
    dubOnly: false,
    dateField: "none",
    rolling: { mode: "none", amount: 7, unit: "days" },
    labelIds: [],
  };
}

function feed(id: string, name: string, description: string, min: number | null, max: number | null): Feed {
  return {
    id,
    kind: "logic",
    name,
    description,
    showDescription: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    filters: filters({ id: `${id}-popularity-band`, metric: "popularityPercentile", min, max }),
    sort: [{ id: `${id}-fan-rank`, metric: "fanFavouriteDiscoveryPercentile", direction: "desc" }],
    view: { ...view, visible: { ...visible }, metricSlots: [...view.metricSlots] },
    coverTitleIds: [],
    titleIds: [],
    orderMode: "automatic",
    newTitlePlacement: "top",
    nonAniListPlacement: "top",
  };
}

export const ANIME_DEFAULT_FEEDS: Feed[] = [
  feed("anime-top-1", "Top 1%", "Popularity percentile 99-100 | sorted by Fan Rank", 99, null),
  feed("anime-mainstream", "Mainstream", "Popularity percentile 90-99 | sorted by Fan Rank", 90, 98.9999),
  feed("anime-strong-picks", "Strong picks", "Popularity percentile 80-90 | sorted by Fan Rank", 80, 89.9999),
  feed("anime-upcoming", "Upcoming", "Popularity percentile 70-80 | sorted by Fan Rank", 70, 79.9999),
  feed("anime-all-others", "All others", "Popularity percentile below 70 | sorted by Fan Rank", null, 69.9999),
];

export const ANIME_DEFAULT_FEED_SEGMENTS: FeedSegment[] = [
  {
    id: "anime-popularity-bands",
    library: "logic",
    name: "DISCOVERY BANDS",
    feedIds: ANIME_DEFAULT_FEEDS.map((item) => item.id),
    collapsed: false,
    hiddenFromHome: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
];
