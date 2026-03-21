import { ISODateTime } from './common';

/**
 * A provider-scoped account (e.g., "psagot-joint", "psagot-ira").
 * One provider can have multiple accounts. One account belongs to exactly one provider.
 * No deletion in R3 — accounts are append/update only.
 */
export interface Account {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}
