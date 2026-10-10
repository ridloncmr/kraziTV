import type {
  Kysely,
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  RootOperationNode,
} from "kysely";

interface QueryCounter<DB> {
  /** The same database, counting every statement executed through it. */
  readonly db: Kysely<DB>;
  /** Statements executed so far. */
  readonly count: () => number;
  /** Rows those statements returned, so a test can prove a read stays narrow. */
  readonly rows: () => number;
}

/**
 * Wraps a database so a test can assert how many statements some work ran,
 * and how many rows they returned,
 * proving that work stays bounded without timing it. `onQuery` sees each
 * statement just before it executes, so a test can act between the statements
 * of one unit of work, such as checking whether the event loop ran between them.
 */
export function countQueries<DB>(
  db: Kysely<DB>,
  onQuery?: (node: RootOperationNode) => void,
): QueryCounter<DB> {
  let count = 0;
  let rows = 0;
  const plugin: KyselyPlugin = {
    transformQuery: (args: PluginTransformQueryArgs) => {
      count += 1;
      onQuery?.(args.node);
      return args.node;
    },
    transformResult: async (args: PluginTransformResultArgs) => {
      rows += args.result.rows.length;
      return args.result;
    },
  };
  return { db: db.withPlugin(plugin), count: () => count, rows: () => rows };
}
