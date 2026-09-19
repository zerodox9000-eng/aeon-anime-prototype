import Dexie, { type Table } from "dexie";
import type { HistoryMap, RecommendationFeature, SeriesCatalog, SeriesDetail, SyncMeta, TagNode } from "../domain/types";

export class ManhwaLibraryDb extends Dexie {
  catalog!: Table<SeriesCatalog, number>;
  tags!: Table<TagNode, number>;
  details!: Table<SeriesDetail, number>;
  recommendationFeatures!: Table<RecommendationFeature, number>;
  history!: Table<{ id: string; entries: HistoryMap[string] }, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super("manhwa-library");
    this.version(1).stores({
      catalog: "id, display_title, year, status, content_rating",
      tags: "id, parent_id, level, is_genre",
      details: "id, display_title",
      recommendationFeatures: "id",
      history: "id",
      meta: "key",
    });
    this.version(2).stores({
      catalog: "id, display_title, year, status, content_rating",
      tags: "id, parent_id, level, is_genre",
      details: "id, display_title",
      recommendationFeatures: "id",
      history: "id",
      meta: "key",
    });
  }
}

export const db = new ManhwaLibraryDb();

export async function saveSyncMeta(meta: SyncMeta) {
  await db.meta.put({ key: "sync", value: meta });
}

export async function loadSyncMeta() {
  const row = await db.meta.get("sync");
  return (row?.value as SyncMeta | undefined) ?? null;
}
