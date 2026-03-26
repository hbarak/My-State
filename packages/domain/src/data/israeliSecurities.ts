/**
 * Static lookup table: 8-digit Israeli security number → Yahoo Finance ticker.
 *
 * Source: TASE (Tel Aviv Stock Exchange) + known Psagot portfolio holdings.
 * Maintained manually; supplemented by name-search fallback via TickerSearcher.
 * DECISION_LOG #37 (S6-DEV-03): static table is primary, name-search is fallback.
 *
 * To add entries: look up the security on finance.yahoo.com or tase.co.il,
 * confirm the ticker is live and matches, then add the 8-digit ISIN/TASE code.
 */

/** Map<securityId (8-digit TASE code), Yahoo Finance ticker symbol> */
export const ISRAELI_SECURITY_TABLE: ReadonlyMap<string, string> = new Map([
  // Banks
  ['604611', 'LUMI.TA'],      // Bank Leumi
  ['694120', 'HAPOALIM.TA'], // Bank Hapoalim  (Yahoo: HAPOALIM.TA)
  ['662577', 'MIZRAHI.TA'],  // Mizrahi Tefahot Bank
  ['604603', 'FIBI.TA'],     // First International Bank (FIBI)

  // Energy & Infrastructure
  ['1084128', 'DLEKG.TA'],   // Delek Group
  ['476530', 'DELEAS.TA'],   // Delek Energy (Delek Drilling)

  // Pharma & Biotech
  ['629014', 'TEVA.TA'],     // Teva Pharmaceutical

  // Insurance
  ['1081686', 'MGDL.TA'],    // Migdal Insurance
  ['525900', 'HRAL.TA'],     // Harel Insurance

  // Technology & Telecom
  ['315750', 'NICE.TA'],     // NICE Systems
  ['346561', 'AMDOCS.TA'],   // Amdocs (TASE-listed)
  ['683777', 'BEZQ.TA'],     // Bezeq Israeli Telecom

  // Real Estate
  ['358762', 'AZRG.TA'],     // Azrieli Group
  ['585018', 'ELCO.TA'],     // El-Co (Electra)

  // Retail & Consumer
  ['239610', 'SHUFL.TA'],    // Shufersal (Super-Pharm parent)
  ['571356', 'CRSM.TA'],     // Castro Model

  // Defense & Aerospace
  ['476560', 'ESLT.TA'],     // Elbit Systems
  ['315263', 'IAI.TA'],      // Israel Aerospace Industries (if publicly traded)

  // Chemicals & Materials
  ['285234', 'ICL.TA'],      // Israel Chemicals (ICL Group)
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
