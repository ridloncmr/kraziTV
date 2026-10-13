/**
 * Marks a member whose file is missing. It stays in the collection, since
 * missing status is temporary, but cannot air; the icon and text carry
 * that, so it never relies on color alone.
 */
export function MissingLabel() {
  return (
    <span className="warning-label">
      <span role="img" aria-label="Warning">
        ⚠
      </span>{" "}
      Missing — won't air until the file returns
    </span>
  );
}
