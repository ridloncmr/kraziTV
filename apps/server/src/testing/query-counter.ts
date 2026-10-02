import type {
  Kysely,
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
} from "kysely";

interface QueryCounter<DB> {
  /** The same database, counting every statement executed through it. */
  readonly db: Kysely<DB>;
  /** Statements executed so far. */
  readonly count: () => number;
}

/**
 * Wraps a database so a test can assert how many statements some work ran,
 * proving that work stays bounded without timing it.
 */
export function countQueries<DB>(db: Kysely<DB>): QueryCounter<DB> {
  let count = 0;
  const plugin: KyselyPlugin = {
    transformQuery: (args: PluginTransformQueryArgs) => {
      count += 1;
      return args.node;
    },
    transformResult: async (args: PluginTransformResultArgs) => args.result,
  };
  return { db: db.withPlugin(plugin), count: () => count };
}
