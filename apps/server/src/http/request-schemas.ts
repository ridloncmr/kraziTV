import { z } from "zod";

/** Route parameters for every `/:id` resource route. */
export const idParams = z.object({ id: z.string() });

/** A display name: trimmed, and never empty once trimmed. */
export const nameField = z.string().trim().min(1, "name must not be empty");
