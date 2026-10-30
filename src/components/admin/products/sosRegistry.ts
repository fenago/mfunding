// ─────────────────────────────────────────────────────────────────────────────
// State business-entity registries — one verified link per state
//
// Bitty names "Secretary of State active and in good standing" as a hard
// requirement on every file, and until now a closer with a Michigan merchant
// had to go and find Michigan's registry mid-call. Three things make that
// worse than it sounds, and all three are why this file exists rather than a
// google link:
//
//   1. FOURTEEN of these are not run by a Secretary of State. Searching
//      "Arizona Secretary of State business search" does not reach the Arizona
//      Corporation Commission. Alaska and DC have no Secretary of State at all
//      for this purpose. So the agency NAME travels with the link.
//   2. SEVEN have moved since our last list and the old URL is dead or worse
//      than dead — Michigan retired COFS in June 2025, Tennessee retired
//      TNBEAR, Wisconsin's wdfi.org no longer resolves in DNS, New Mexico's
//      old portal no longer resolves either, and Arizona's and Nevada's
//      obvious URLs now land on a LOGIN WALL rather than a search.
//   3. Texas has no free Secretary of State search at all. SOSDirect is a
//      dollar a search behind an account. The free check is the Comptroller's,
//      which answers a DIFFERENT question — franchise-tax standing, not
//      registration standing — and the note says so rather than letting a
//      closer assume they are the same fact.
//
// Every URL below was fetched and the search form confirmed on 2026-10-30,
// except the two labelled otherwise. `check` is shown in the UI: a link
// nobody has opened is labelled, never silently presented as verified. Same
// rule the funder portals follow.
// ─────────────────────────────────────────────────────────────────────────────

export type SosEntry = {
  code: string;
  state: string;
  /** Who actually keeps the register. Not "Secretary of State" everywhere. */
  agency: string;
  url: string;
  /**
   * confirmed — fetched 2026-10-30, the search form rendered
   * landing   — no stable deep link exists; this is the hub, one more click
   * unchecked — could not be made to render; probably right, open it once
   */
  check: "confirmed" | "landing" | "unchecked";
  /** Only where a closer would otherwise get it wrong. */
  note?: string;
};

export const SOS_REGISTRY: SosEntry[] = [
  { code: "AL", state: "Alabama", agency: "Secretary of State", url: "https://arc-sos.state.al.us/CGI/corpname.mbr/input", check: "confirmed" },
  { code: "AK", state: "Alaska", agency: "Dept. of Commerce — Division of Corporations", url: "https://www.commerce.alaska.gov/cbp/main/search/entities", check: "confirmed", note: "Alaska has no Secretary of State. Do not go looking for one." },
  { code: "AZ", state: "Arizona", agency: "Arizona Corporation Commission", url: "https://arizonabusinesscenter.azcc.gov/businesssearch", check: "confirmed", note: "NOT the Secretary of State — Arizona's register is the Corporation Commission. The ecorp /EntitySearch URL you may find by searching is a login wall; this one is the public search." },
  { code: "AR", state: "Arkansas", agency: "Secretary of State", url: "https://sos-corp-search.ark.org/corps", check: "confirmed" },
  { code: "CA", state: "California", agency: "Secretary of State", url: "https://bizfileonline.sos.ca.gov/search/business", check: "confirmed" },
  { code: "CO", state: "Colorado", agency: "Secretary of State", url: "https://www.sos.state.co.us/biz/BusinessEntityCriteriaExt.do", check: "confirmed" },
  { code: "CT", state: "Connecticut", agency: "Secretary of the State", url: "https://service.ct.gov/business/s/onlinebusinesssearch", check: "confirmed" },
  { code: "DE", state: "Delaware", agency: "Division of Corporations", url: "https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx", check: "confirmed" },
  { code: "DC", state: "District of Columbia", agency: "Dept. of Licensing and Consumer Protection", url: "https://boss.dc.gov/homepage", check: "landing", note: "No direct search link exists — BOSS replaced CorpOnline in August 2026 and every deep route bounces to an Access DC login. Land here and click the Global Search tile. DC has no Secretary of State for business registration." },
  { code: "FL", state: "Florida", agency: "Division of Corporations (Sunbiz)", url: "https://search.sunbiz.org/Inquiry/CorporationSearch/ByName", check: "confirmed", note: "Florida's register is the Department of State, not an elected Secretary of State." },
  { code: "GA", state: "Georgia", agency: "Secretary of State — Corporations Division", url: "https://ecorp.sos.ga.gov/BusinessSearch", check: "confirmed" },
  { code: "HI", state: "Hawaii", agency: "Dept. of Commerce and Consumer Affairs", url: "https://hbe.ehawaii.gov/documents/search.html", check: "confirmed", note: "DCCA, not a Secretary of State." },
  { code: "ID", state: "Idaho", agency: "Secretary of State", url: "https://sosbiz.idaho.gov/search/business", check: "confirmed" },
  { code: "IL", state: "Illinois", agency: "Secretary of State — Business Services", url: "https://apps.ilsos.gov/businessentitysearch/", check: "confirmed" },
  { code: "IN", state: "Indiana", agency: "Secretary of State (INBiz portal)", url: "https://inbiz.in.gov/business-search", check: "confirmed", note: "The old bsd.sos.in.gov search is unreachable. INBiz is the state's current public search." },
  { code: "IA", state: "Iowa", agency: "Secretary of State", url: "https://sos.iowa.gov/search/business/search.aspx", check: "confirmed" },
  { code: "KS", state: "Kansas", agency: "Secretary of State", url: "https://www.sos.ks.gov/eforms/BusinessEntity/Search.aspx", check: "confirmed" },
  { code: "KY", state: "Kentucky", agency: "Secretary of State", url: "https://sosbes.sos.ky.gov/BusSearchNProfile/search.aspx", check: "confirmed", note: "The web.sos.ky.gov address is the filing app, not the search. This is the search." },
  { code: "LA", state: "Louisiana", agency: "Secretary of State", url: "https://coraweb.sos.la.gov/CommercialSearch/CommercialSearch.aspx", check: "confirmed" },
  { code: "ME", state: "Maine", agency: "Secretary of State — Division of Corporations", url: "https://apps3.web.maine.gov/nei-sos-icrs/ICRS?MainPage=x", check: "confirmed", note: "Moved off informe.org. There is a reCAPTCHA on submit." },
  { code: "MD", state: "Maryland", agency: "Dept. of Assessments and Taxation (SDAT)", url: "https://egov.maryland.gov/BusinessExpress/EntitySearch", check: "confirmed", note: "SDAT is a tax assessment agency, not a Secretary of State." },
  { code: "MA", state: "Massachusetts", agency: "Secretary of the Commonwealth — Corporations Division", url: "https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx", check: "confirmed" },
  { code: "MI", state: "Michigan", agency: "LARA — Corporations Division", url: "https://mibusinessregistry.lara.state.mi.us/search/business", check: "confirmed", note: "NOT the Secretary of State — Michigan's register is LARA. The old COFS site was retired in June 2025 and its certificate is now broken." },
  { code: "MN", state: "Minnesota", agency: "Secretary of State", url: "https://mblsportal.sos.mn.gov/Business/Search", check: "confirmed" },
  { code: "MS", state: "Mississippi", agency: "Secretary of State", url: "https://corp.sos.ms.gov/corp/portal/c/page/corpBusinessIdSearch/portal.aspx", check: "confirmed" },
  { code: "MO", state: "Missouri", agency: "Secretary of State", url: "https://bsd.sos.mo.gov/BusinessEntity/BESearch.aspx?SearchType=0", check: "confirmed", note: "The older /search/business path now throws an application error." },
  { code: "MT", state: "Montana", agency: "Secretary of State", url: "https://biz.sosmt.gov/search/business", check: "confirmed" },
  { code: "NE", state: "Nebraska", agency: "Secretary of State", url: "https://www.nebraska.gov/sos/corp/corpsearch.cgi", check: "confirmed" },
  { code: "NV", state: "Nevada", agency: "Secretary of State (ORION portal)", url: "https://orion.nv.gov/portal/public/#/public/nvsos/en/CaseXscreen?screen=external-GenericFilingsSearch&tabRoute=business", check: "confirmed", note: "Long link on purpose. The SilverFlume address still printed on nvsos.gov now redirects to a sign-in page; this one opens the free search directly." },
  { code: "NH", state: "New Hampshire", agency: "Secretary of State (QuickStart)", url: "https://quickstart.sos.nh.gov/online/BusinessInquire", check: "confirmed" },
  { code: "NJ", state: "New Jersey", agency: "Division of Revenue and Enterprise Services", url: "https://www.njportal.com/DOR/BusinessNameSearch", check: "confirmed", note: "DORES, not a Secretary of State." },
  { code: "NM", state: "New Mexico", agency: "Secretary of State", url: "https://enterprise.sos.nm.gov/search/business", check: "confirmed", note: "The old portal.sos.state.nm.us host no longer resolves at all." },
  { code: "NY", state: "New York", agency: "Dept. of State — Division of Corporations", url: "https://apps.dos.ny.gov/publicInquiry/", check: "confirmed", note: "Department of State, not an elected Secretary of State." },
  { code: "NC", state: "North Carolina", agency: "Secretary of State", url: "https://www.sosnc.gov/online_services/search/by_title/_Business_Registration", check: "confirmed", note: "Their site notice forbids automated searching. Fine to click; never point a script at it." },
  { code: "ND", state: "North Dakota", agency: "Secretary of State", url: "https://firststop.sos.nd.gov/search/business", check: "confirmed" },
  { code: "OH", state: "Ohio", agency: "Secretary of State", url: "https://businesssearch.ohiosos.gov/", check: "confirmed" },
  { code: "OK", state: "Oklahoma", agency: "Secretary of State", url: "https://www.sos.ok.gov/corp/corpInquiryFind.aspx", check: "confirmed" },
  { code: "OR", state: "Oregon", agency: "Secretary of State", url: "https://sos.oregon.gov/business/pages/find.aspx", check: "confirmed" },
  { code: "PA", state: "Pennsylvania", agency: "Dept. of State — Bureau of Corporations", url: "https://file.dos.pa.gov/search/business", check: "confirmed" },
  { code: "RI", state: "Rhode Island", agency: "Secretary of State", url: "https://business.sos.ri.gov/CorpWeb/CorpSearch/CorpSearch.aspx", check: "confirmed" },
  { code: "SC", state: "South Carolina", agency: "Secretary of State", url: "https://businessfilings.sc.gov/BusinessFiling/Entity/Search", check: "confirmed" },
  { code: "SD", state: "South Dakota", agency: "Secretary of State", url: "https://sosenterprise.sd.gov/BusinessServices/Business/FilingSearch.aspx", check: "confirmed" },
  { code: "TN", state: "Tennessee", agency: "Secretary of State — Business Services", url: "https://tncab.tnsos.gov/business-entity-search", check: "confirmed", note: "TNBEAR was retired for the TNCaB portal; the old address is gone." },
  { code: "TX", state: "Texas", agency: "Comptroller of Public Accounts", url: "https://comptroller.texas.gov/taxes/franchise/account-status/search", check: "confirmed", note: "⚠ Texas has NO free Secretary of State search — SOSDirect charges per search. This free one reports FRANCHISE TAX standing, which is not the same fact as registration standing. Good enough to prove the business is real and current; do not quote it as SOS good standing." },
  { code: "UT", state: "Utah", agency: "Division of Corporations and Commercial Code", url: "https://businessregistration.utah.gov/EntitySearch/OnlineEntitySearch", check: "unchecked", note: "Could not be made to render from outside — it kept bouncing to the portal landing page. The state advertises it as a no-login search, so it is probably right. If it bounces, go to businessregistration.utah.gov and take the search link from there, then tell ops so this can be fixed." },
  { code: "VT", state: "Vermont", agency: "Secretary of State", url: "https://bizfilings.vermont.gov/online/BusinessInquire/", check: "confirmed" },
  { code: "VA", state: "Virginia", agency: "State Corporation Commission", url: "https://cis.scc.virginia.gov/EntitySearch/Index", check: "confirmed", note: "The SCC, not the Secretary of the Commonwealth." },
  { code: "WA", state: "Washington", agency: "Secretary of State", url: "https://ccfs.sos.wa.gov/", check: "confirmed" },
  { code: "WV", state: "West Virginia", agency: "Secretary of State", url: "https://apps.sos.wv.gov/business/corporations/", check: "confirmed" },
  { code: "WI", state: "Wisconsin", agency: "Dept. of Financial Institutions (DFI)", url: "https://apps.dfi.wi.gov/apps/corpsearch/search.aspx", check: "confirmed", note: "NOT the Secretary of State — Wisconsin's register is the DFI, and the old wdfi.org host no longer resolves." },
  { code: "WY", state: "Wyoming", agency: "Secretary of State", url: "https://wyobiz.wyo.gov/Business/FilingSearch.aspx", check: "confirmed" },
];
