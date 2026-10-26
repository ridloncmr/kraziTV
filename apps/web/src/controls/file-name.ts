/** The last segment of a path the server reports on either platform, for lists that name only the file. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}
