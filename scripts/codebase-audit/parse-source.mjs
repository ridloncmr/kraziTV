// Parses inventory files with the TypeScript compiler for the syntactic rules.

import ts from "typescript";

/** Parses one file without type information; every audit rule is syntactic. */
export function parseSource(file) {
  return ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}
