import { ISODateTime, SyncStatus } from './common';

export type SyncScope = 'transactions' | 'holdings' | 'accounts' | 'all';
export type SyncTrigger = 'manual' | 'app_launch' | 'scheduled';

export interface SyncJob {
  id: string;
  scope: SyncScope;
  trigger: SyncTrigger;
  status: SyncStatus;
  startedAt: ISODateTime;
  finishedAt?: ISODateTime;
  pushedCount: number;
  pulledCount: number;
  errorMessage?: string;
}
