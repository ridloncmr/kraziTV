/**
 * Rolls back a reservation write whose regeneration would change the end,
 * and so the on-screen resume time, of the planned filler airing now
 * (programming spec 0006). Thrown inside the write's immediate transaction
 * so nothing it wrote commits; routes answer it as a refusal.
 */
export class AiringFillerConflictError extends Error {
  readonly fillerEndsAt: number;

  // Names the end the airing filler must keep, for the refusal's details.
  constructor(fillerEndsAt: number) {
    super("A reservation write would change the planned filler airing now");
    this.name = "AiringFillerConflictError";
    this.fillerEndsAt = fillerEndsAt;
  }
}
