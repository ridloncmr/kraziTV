export interface SessionTable {
  id: string;
  account_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
}
