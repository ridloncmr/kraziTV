import { useState, type FormEvent } from "react";
import { useMutation } from "../http/use-resource.js";

/** What a task's fields ask the server to apply, or why nothing is sent. */
type TaskRequest = { body: unknown } | { refusal: string };

/** One Account Settings task's submit handler and the state its page shows. */
export interface AccountTask {
  submit: (event: FormEvent<HTMLFormElement>) => void;
  /** Why the task's own check refused the fields; nothing was sent. */
  refusal: string | undefined;
  pending: boolean;
  /** The server's refusal of the last request sent. */
  error: Error | undefined;
}

/**
 * The submit sequence every Account Settings task shares: the task prepares a
 * request from its fields, a client refusal never reaches the server, and the
 * server's answer goes to `onDone`. A server refusal stays in `error`, not
 * thrown, so the task's page can show it and the owner can correct and resend.
 */
export function useAccountTask<T>(
  path: string,
  method: string,
  prepare: (form: FormData) => TaskRequest,
  onDone: (answer: T) => void,
): AccountTask {
  const [refusal, setRefusal] = useState<string>();
  const request = useMutation();

  /** Sends what the task prepared from its fields, unless the task refused them. */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prepared = prepare(new FormData(event.currentTarget));
    if ("refusal" in prepared) {
      setRefusal(prepared.refusal);
      return;
    }
    setRefusal(undefined);
    void request.run<T>(path, method, prepared.body, onDone);
  }

  return {
    submit,
    refusal,
    pending: request.pending,
    error: request.error,
  };
}
