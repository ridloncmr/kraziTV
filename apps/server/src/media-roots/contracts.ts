export interface MediaRoot {
  id: string;
  path: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastScannedAt: number | null;
}

export type CreateMediaRootResult =
  { kind: "created"; root: MediaRoot } | { kind: "duplicate" };
