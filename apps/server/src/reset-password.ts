// Resets the one account's password from a shell on the server host (ADR
// 0012). Run with `npm run reset-password`. The prompt is promptHidden and
// the reset is AuthService.resetPassword, so both are testable without a
// terminal; this file only orders the checks and reports each outcome.
import { existsSync } from "node:fs";

import { pino } from "pino";

import { AuthService } from "./auth/auth-service.js";
import { newPasswordField } from "./auth/passwords/password-rules.js";
import {
  resolveDatabasePath,
  resolveDataDirectory,
} from "./config/data-directory.js";
import { openDatabase } from "./database/database.js";
import { WriteAuthorityBusyError } from "./database/writes/immediate-transaction.js";
import { PromptCancelled, promptHidden } from "./terminal/hidden-prompt.js";

/**
 * Prompts twice and resets the password, reporting each refusal as one plain
 * line. Returns the exit code: 0 on success, 1 when nothing changed, 130 when
 * the operator cancelled or input ended before the password was entered.
 */
async function main(): Promise<number> {
  const dataDirectory = resolveDataDirectory(
    process.env.KRAZITV_DATA_DIR,
    process.cwd(),
  );
  // Checked before opening, which would create an empty database here.
  if (!existsSync(resolveDatabasePath(dataDirectory))) {
    console.error(
      `No kraziTV account exists yet: there is no database in ${dataDirectory}. Set up the account in the web app first.`,
    );
    return 1;
  }

  const database = await openDatabase({ dataDirectory });
  try {
    const auth = new AuthService(database.db);
    if ((await auth.state(undefined, pino({ level: "warn" }))).setupRequired) {
      console.error(
        `No kraziTV account exists yet in ${dataDirectory}. Set up the account in the web app first.`,
      );
      return 1;
    }
    // A piped password could be logged or kept in shell history.
    if (!process.stdin.isTTY) {
      console.error(
        "reset-password must run in an interactive terminal, so the new password is typed without being echoed or stored. On Windows, run it from PowerShell or Windows Terminal; Git Bash in mintty may not report a terminal to Node.",
      );
      return 1;
    }

    const password = await promptHidden(
      "New password: ",
      process.stdin,
      process.stdout,
    );
    const repeated = await promptHidden(
      "Repeat the new password: ",
      process.stdin,
      process.stdout,
    );
    if (password !== repeated) {
      console.error("The passwords do not match; nothing was changed.");
      return 1;
    }
    const rules = newPasswordField.safeParse(password);
    if (!rules.success) {
      console.error(
        `${rules.error.issues[0]?.message ?? "invalid password"}; nothing was changed.`,
      );
      return 1;
    }

    const result = await auth.resetPassword(password);
    if (result.kind === "setup_required") {
      console.error("No kraziTV account exists yet; nothing was changed.");
      return 1;
    }
    console.log(
      "Password reset. Every session was ended; log in with the new password. A running server keeps any failed-login wait until it passes.",
    );
    return 0;
  } catch (error) {
    if (error instanceof PromptCancelled) {
      console.error("Cancelled; nothing was changed.");
      return 130;
    }
    if (error instanceof WriteAuthorityBusyError) {
      console.error(
        "The database is busy with another write, probably the running server; nothing was changed. Try again in a moment.",
      );
      return 1;
    }
    throw error;
  } finally {
    await database.close();
  }
}

process.exitCode = await main();
