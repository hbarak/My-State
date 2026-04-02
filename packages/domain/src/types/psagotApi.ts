export interface PsagotCredentials {
  readonly username: string;
  readonly password: string;
}

export interface PsagotPendingSession {
  readonly csession: string;
  readonly status: 'pending_otp';
}

export interface PsagotAuthorizedSession {
  readonly sessionKey: string;
  readonly csession: string;
  readonly status: 'authorized';
  readonly authorizedAt: number;
}

export interface PsagotAccount {
  readonly key: string;
  readonly name: string;
  readonly nickname: string;
}

export interface PsagotBalance {
  readonly equityNumber: string;
  readonly quantity: number;
  readonly lastRate: number;
  readonly averagePrice: number;
  readonly marketValue: number;
  readonly marketValueNis: number;
  readonly profitLoss: number;
  readonly profitLossNis: number;
  readonly profitLossPct: number;
  readonly portfolioWeight: number;
  readonly currencyCode: string;
  readonly source: string;
  readonly subAccount: string;
  readonly hebName: string | null;
}

export interface PsagotSecurityInfo {
  readonly equityNumber: string;
  readonly hebName: string | null;
  readonly engName: string | null;
  readonly engSymbol: string | null;
  readonly exchange: string | null;
  readonly currencyCode: string | null;
  /** 1 = whole units, 100 = agorot (divide by 100 to get ILS) */
  readonly currencyDivider: number;
  readonly isForeign: boolean;
  readonly itemType: string | null;
}

export interface PsagotAccountSummary {
  readonly onlineCash: number;
  readonly morningCash: number;
  readonly onlineValue: number;
  readonly morningValue: number;
  readonly profitLoss: number;
  readonly profitLossPct: number;
  readonly cashByCurrency: Record<string, number>;
}

export type PsagotApiError =
  | { readonly type: 'auth_failed'; readonly message: string }
  | { readonly type: 'otp_invalid'; readonly message: string }
  | { readonly type: 'otp_expired'; readonly message: string }
  | { readonly type: 'session_expired'; readonly message: string }
  | { readonly type: 'network_error'; readonly message: string; readonly cause?: Error }
  | { readonly type: 'api_error'; readonly message: string; readonly statusCode?: number };
