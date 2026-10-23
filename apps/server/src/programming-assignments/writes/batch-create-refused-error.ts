import type { BatchCreateRefusal } from "../contracts.js";

/**
 * Rolls back a batch assignment create when one of its assignments is
 * refused (programming spec 0008). Thrown inside the write's immediate
 * transaction so none of the batch commits; routes answer it as that
 * assignment's refusal, naming its request index.
 */
export class BatchCreateRefusedError extends Error {
  readonly index: number;
  readonly refusal: BatchCreateRefusal;

  // Names the refused assignment's request index and why it was refused.
  constructor(index: number, refusal: BatchCreateRefusal) {
    super(`Batch assignment ${index} was refused: ${refusal.kind}`);
    this.name = "BatchCreateRefusedError";
    this.index = index;
    this.refusal = refusal;
  }
}
