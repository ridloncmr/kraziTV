// Resets the one account's password from a shell on the server host (ADR
// 0012). Run with `npm run reset-password`. The prompt lives here; the reset
// itself is AuthService.resetPassword, so it is testable without a terminal.
import { existsSync } from "node:fs";

import { AuthService } from "./auth/auth-service.js";
import { newPasswordField } from "./auth/passwords/password-rules.js";
import {
  resolveDatabasePath,
  resolveDataDirectory,
} from "./config/data-directory.js";
import { openDatabase } from "./database/database.js";
import { WriteAuthorityBusyError } from "./database/writes/immediate-transaction.js";

const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const ESCAPE = "\u001b";
const BACKSPACES = new Set(["\b", "\u007f"]);

/** Thrown when the operator cancels a prompt with Ctrl+C or Ctrl+D. */
class PromptCancelled extends Error {}

/**
 * Reads one line from a terminal without echoing it, so the password never
 * appears on screen. Raw mode hands over every key, so this handles Enter,
 * Backspace, and Ctrl+C itself, the same way on Windows and POSIX terminals.
 * Arrow keys and other escape sequences are ignored, never typed.
 */
function promptHidden(question: string): Promise<string> {
  const input = process.stdin;
  process.stdout.write(question);
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();

  return new Promise((resolve, reject) => {
    let typed: string[] = [];
    const finish = (error?: Error) => {
      input.off("data", onKeys);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error === undefined) resolve(typed.join(""));
      else reject(error);
    };
    const onKeys = (keys: string) => {
      if (keys.startsWith(ESCAPE)) return;
      for (const key of keys) {
        if (key === "\r" || key === "\n") return finish();
        if (key === CTRL_C || (key === CTRL_D && typed.length === 0)) {
          return finish(new PromptCancelled());
        }
        if (BACKSPACES.has(key)) typed = typed.slice(0, -1);
        else if (key >= " ") typed.push(key);
      }
    };
    input.on("data", onKeys);
  });
}

/**
 * Prompts twice and resets the password, reporting each refusal as one plain
 * line. Returns the exit code: 0 on success, 1 when nothing changed, 130 when
 * the operator cancelled.
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
    if ((await auth.state(undefined)).setupRequired) {
      console.error(
        `No kraziTV account exists yet in ${dataDirectory}. Set up the account in the web app first.`,
      );
      return 1;
    }
    // A piped password could be logged or kept in shell history.
    if (!process.stdin.isTTY) {
      console.error(
        "reset-password must run in an interactive terminal, so the new password is typed without being echoed or stored.",
      );
      return 1;
    }

    const password = await promptHidden("New password: ");
    const repeated = await promptHidden("Repeat the new password: ");
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
