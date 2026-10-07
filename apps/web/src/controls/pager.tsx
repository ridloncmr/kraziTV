/** Moves through a server-paged list; the server's total, not the loaded rows, sets the bounds. */
export function Pager({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  // A shrunken catalog can leave the offset past the end, so Previous stays reachable.
  if (offset === 0 && total <= limit) return null;
  const first = Math.min(offset + 1, total);
  const last = Math.min(offset + limit, total);
  return (
    <nav className="pager" aria-label="Pages">
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <span>
        {first}–{last} of {total}
      </span>
      <button
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        Next
      </button>
    </nav>
  );
}
