/**
 * Static lookup table: 8-digit Israeli security number → EODHD ticker.
 *
 * Source: TASE (Tel Aviv Stock Exchange) + known Psagot portfolio holdings.
 * Maintained manually; supplemented by name-search fallback via TickerSearcher.
 * DECISION_LOG #37 (S6-DEV-03): static table is primary, name-search is fallback.
 *
 * To add entries: verify the ticker against EODHD's /api/search endpoint,
 * confirm price is returned by /api/real-time, then add the 8-digit TASE code.
 * Note: some Israeli companies trade on US exchanges (no .TA suffix).
 */

/** Map<securityId (8-digit TASE code), EODHD ticker symbol> */
export const ISRAELI_SECURITY_TABLE: ReadonlyMap<string, string> = new Map([
  // Banks
  ['604611', 'LUMI.TA'],     // Bank Leumi
  ['694120', 'POLI.TA'],     // Bank Hapoalim
  ['662577', 'MZTF.TA'],     // Mizrahi Tefahot Bank
  ['604603', 'FIBI.TA'],     // First International Bank (FIBI)

  // Energy & Infrastructure
  ['1084128', 'DLEKG.TA'],   // Delek Group
  ['476530', 'DKDRF'],       // Delek Drilling (US OTC)

  // Pharma & Biotech
  ['629014', 'TEVA.TA'],     // Teva Pharmaceutical

  // Insurance
  ['1081686', 'MGDL.TA'],    // Migdal Insurance
  ['525900', 'HARL.TA'],     // Harel Insurance

  // Technology & Telecom
  ['315750', 'NICE.TA'],     // NICE Systems
  ['346561', 'DOX'],         // Amdocs (NASDAQ)
  ['683777', 'BEZQ.TA'],     // Bezeq Israeli Telecom

  // Real Estate
  ['358762', 'AZRG.TA'],     // Azrieli Group
  ['585018', 'ELCO.TA'],     // El-Co (Electra)

  // Retail & Consumer
  ['239610', 'SAE.TA'],      // Shufersal

  // Defense & Aerospace
  ['476560', 'ESLT.TA'],     // Elbit Systems

  // Chemicals & Materials
  ['285234', 'ICL.TA'],      // Israel Chemicals (ICL Group)

  // TASE mutual funds / ETFs — identified by their TASE numeric ID.
  // These cannot be resolved via EODHD (no Morningstar-ID mapping available).
  // The ticker is the TASE numeric ID itself; FanOutPriceFetcher routes
  // all-digit tickers to the Maya TASE API (mayaapi.tase.co.il).
  ['1183441', '1183441'],    // S&P500 אינ.חוץ (S&P500 tracker mutual fund)
  ['5112628', '5112628'],    // IBI TA-125 תא (IBI TA-125 ETF)
  ['5130919', '5130919'],    // IBI TA-90 תא (IBI TA-90 ETF)
  ['1209444', '1209444'],    // IBI TA-90 variant (90-ת"א.IBI)
  ['72179369', '72179369'],  // FIDELITY WISE O (foreign fund listed on TASE)
  ['75416503', '75416503'],  // SPROTT JR COPPE (foreign fund listed on TASE)
]);

/** Port interface for Israeli security number → ticker lookup */
export interface IsraeliSecurityLookup {
  /** Returns the Yahoo Finance ticker for the given 8-digit security ID, or null if not found. */
  lookup(securityId: string): string | null;
}

/** Concrete implementation backed by the static ISRAELI_SECURITY_TABLE */
export class IsraeliSecurityLookupImpl implements IsraeliSecurityLookup {
  lookup(securityId: string): string | null {
    return ISRAELI_SECURITY_TABLE.get(securityId) ?? null;
  }
}
