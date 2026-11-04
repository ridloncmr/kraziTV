import { useState } from "react";

/**
 * A TMDB poster that hides itself when its image cannot load, so an owner
 * whose network blocks `image.tmdb.org`, or who is offline, sees the facts
 * take the full width instead of a broken-image glyph. The failure is
 * remembered per URL, so a new poster in the same slot tries again.
 */
export function Poster({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  if (failedSrc === src) return null;
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      onError={() => setFailedSrc(src)}
    />
  );
}
