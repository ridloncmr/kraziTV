import type { ReactNode } from "react";

/**
 * The full-window welcome background the logon and setup screens share: dark
 * bands top and bottom, a lighter band between them edged by thin highlight
 * lines. `hint` sits in the lower-right of the bottom band.
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
        {hint && <p className="logon-hint">{hint}</p>}
      </footer>
    </main>
  );
}
