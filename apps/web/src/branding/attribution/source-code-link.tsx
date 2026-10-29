// Where kraziTV's corresponding source lives, offered to everyone who uses
// it over the network, as AGPL-3.0 section 13 requires.
const SOURCE_CODE_URL = "https://github.com/ridloncmr/kraziTV";

/**
 * A link to kraziTV's source, on every screen a network user sees first:
 * the logon screen and Start. It opens in a new tab so the desktop stays.
 */
export function SourceCodeLink({ className }: { className: string }) {
  return (
    <a
      className={className}
      href={SOURCE_CODE_URL}
      target="_blank"
      rel="noreferrer"
      title="kraziTV is free software under the GNU AGPL"
    >
      Source code
    </a>
  );
}
