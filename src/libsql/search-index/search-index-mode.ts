import type { TransactionContext } from "@worlds/sdk/quad-store";
import { isImportCommit } from "@worlds/sdk/quad-store";
import type { SearchIndexOnImport } from "@worlds/sdk/search-index";

/**
 * projectsDuringCommit reports whether a commit writes FTS/vector chunk rows
 * together with its quads: always, except when indexing is disabled or an
 * import defers it to one rebuild pass.
 */
export function projectsDuringCommit(
  mode: SearchIndexOnImport | undefined,
  context?: TransactionContext,
): boolean {
  if (mode === "disabled") return false;
  return !(isImportCommit(context) && mode === "deferred");
}

/**
 * reindexesAfterCommit reports whether a commit is followed by a full rebuild
 * of the search index from the stored quads (a deferred import).
 */
export function reindexesAfterCommit(
  mode: SearchIndexOnImport | undefined,
  context?: TransactionContext,
): boolean {
  return mode === "deferred" && isImportCommit(context);
}
