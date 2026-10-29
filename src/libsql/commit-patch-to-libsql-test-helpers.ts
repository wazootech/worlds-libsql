import {
  LibsqlQuadStore,
  type LibsqlQuadStoreOptions,
} from "./quad-store/mod.ts";
import { LibsqlRdfjsStore } from "./rdfjs-store/mod.ts";
import type { Patch, TransactionContext } from "@worlds/sdk/quad-store";

/** Compat helper wrapping LibsqlQuadStore for testing. */
export function createLibsqlPersistHooks(
  options: Omit<LibsqlQuadStoreOptions, "store">,
) {
  const store = new LibsqlRdfjsStore({
    connection: options.connection,
    matchPageSize: options.matchPageSize,
  });
  const quadStore = new LibsqlQuadStore({
    ...options,
    store,
  });
  return {
    commit: async (patch: Patch, context?: TransactionContext) => {
      const tx = quadStore.createTransaction();
      if (patch.insertions) {
        tx.addQuads(patch.insertions);
      }
      if (patch.deletions) {
        tx.removeQuads(patch.deletions);
      }
      await tx.commit(context);
    },
  };
}
