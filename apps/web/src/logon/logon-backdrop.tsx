import type { ReactNode } from "react";
import { SourceCodeLink } from "../branding/attribution/source-code-link.js";

/**
 * The full-window welcome background the logon and setup screens share: dark
 * bands top and bottom, a lighter band between them edged by thin highlight
 * lines. `hint` sits in the lower-right of the bottom band, and the source
 * code link in its lower-left, before anyone logs on.
 */
export function LogonBackdrop({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <main className="logon-screen" aria-label={label}>
      <div className="logon-band-top" />
      <div className="logon-middle">{children}</div>
      <footer className="logon-band-bottom">
        <SourceCodeLink className="logon-source" />
        {hint && <p className="logon-hint">{hint}</p>}
      </footer>
    </main>
  );
}
