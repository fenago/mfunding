// ─────────────────────────────────────────────────────────────────────────────
// Bitty's industry book — the three lists, in one place
//
// This lives on its own because two surfaces need it and neither should hold
// its own copy: the Bitty playbook tab renders the full lookup, and the Micro
// product line prints the PROHIBITED fourteen straight into the submission
// checklist. A closer should never be told an industry is barred and then sent
// to a different page to find out which ones — so the kill-list travels with
// the checklist item, and both read from this file.
//
// Counts are what the October 2026 guide actually prints, not what its badges
// claim. The guide's own headline numbers for preferred and standard are wrong
// and the playbook says so out loud; the prohibited fourteen match.
// ─────────────────────────────────────────────────────────────────────────────

export const BITTY_PREFERRED = [
  "Advertising", "Agriculture, Forestry, Fishing", "Ambulance", "Architectural / Engineering",
  "Assisted Facility", "Auto Repair", "Barber Shops", "Beauty Salons", "Car Rental", "Car Wash",
  "Child Day Care", "Computer Systems Design", "Cosmetics / Hair Ext. / Supply", "CPA Office / Accountant",
  "Dentist", "Doctor / Physician / Specialist", "Drinking Alcohol", "Driving School",
  "Drycleaner / Laundry", "Employment / Staffing", "Fitness Center", "Florist", "Food Truck",
  "Furniture / Home Retail", "Gas Station", "Graphic Design", "Grocery / Food / Bev. Retail",
  "Home Health Care", "Insurance", "Interior Design", "Janitorial", "Lab / Imaging", "Landscaping",
  "Lawyer", "Manufacturing", "Mental Health", "Mortgage Broker", "Nail Salon",
  "Oil / Gas Support Activities", "Other Information", "Other Legal Services", "Pest", "Pet Care",
  "Photography", "Real Estate Lessor", "Restaurant - Full-service", "Restaurant - Limited-service",
  "Septic Tank", "Spa / Tattoo / Wax", "Sports / Hobby / Music Retail", "Sports / Recreation Instruction",
  "Telecommunications", "Tobacco / Vape", "Trade Show / Convention", "Travel Agency / Arrangement",
  "Tutoring", "Veterinary",
];

export const BITTY_STANDARD = [
  "Accommodation", "Appliance Repair", "Auto Body Shop", "Auto Parts / Tires", "Boat / Marine",
  "Catering", "Chiropractor", "Clothing / Shoes / Acc. Retail", "Construction - Carpentry",
  "Construction - Electrician", "Construction - Flooring", "Construction - Gen. Remodeler",
  "Construction - New Home Builder", "Construction - Other Unclass.", "Construction - Painting",
  "Construction - Plumbing / HVAC", "Construction - Roofing", "Construction - Site Prep / Excav.",
  "Consulting - Management", "Drywall", "Electronics / Appliance Retail", "Fine Arts School",
  "Funeral Home", "General Merchandise Retail", "Health / Personal Care Retail", "Investment Advisor",
  "Jewelry", "Marketing", "Medical Transport (non-emerg.)", "Movie / Music", "Moving", "Notary",
  "Online Seller", "Other Arts / Entertain. / Rec.", "Other Education", "Other Finance",
  "Other Misc. Retail", "Other Personal Services", "Other Prof / Sci / Tech Services",
  "Other Services - Bldgs / Dwellings", "Public Administration", "Real Estate Agent / Broker",
  "Real Estate / Other Activities", "Rental Center / Consumer / Gen.", "Security Guard / Investigation",
  "Security Systems", "Solar", "Taxi / Limo / Shuttle", "Towing / Roadside", "Trucking",
  "T-shirt / Printing", "Wholesale",
];

export const BITTY_PROHIBITED = [
  "Auto Dealer / New, Used", "Bail Bonds", "Cannabis", "Crypto", "Debt Collections", "Gambling",
  "Guns", "Health Supplements", "Money Service Businesses", "Not-for-profit", "Pawn Shops",
  "Psychic Services", "Religious / Grantmaking / Civic", "Sexual Content",
];

// ─────────────────────────────────────────────────────────────────────────────
// The notice Bitty prints above the Industry dropdown on their own application
//
// Captured from Bitty's broker portal, New Applications page — screenshot
// supplied by the owner on 2026-10-30. Quoted verbatim and attributed, never
// paraphrased: what they threaten here is specific, and it is theirs to say.
//
// TWO THINGS IN IT DO NOT MATCH WHAT WE ALREADY HOLD. Neither is resolved.
//
//   1. THE DROPDOWN IS NOT THE GUIDE'S LIST. Their worked examples name
//      "Construction - Commercial" and "Construction - Residential Remodeler".
//      Neither string appears in BITTY_PREFERRED or BITTY_STANDARD above, which
//      we transcribed from the October 2026 underwriting guide — the guide's
//      nearest neighbours are "Construction - Gen. Remodeler" and
//      "Construction - Site Prep / Excav.". So the application's dropdown and
//      the guide's industry book are NOT the same list. At submit time the
//      DROPDOWN is the authority. Our three lists tell you the tier and the
//      kill-list; they do not tell you the exact string to click.
//
//   2. THE COMMISSION NUMBER IS NOT OURS. This page says 16%. Our record of the
//      October 2026 guide caps us at 12%, and 8% on the Access tier. We have
//      never submitted a Bitty file, so neither figure has been tested against
//      a funded deal. Do not quote either one to a merchant or a sub-ISO until
//      somebody at Bitty confirms it in writing.
// ─────────────────────────────────────────────────────────────────────────────

export const BITTY_INDUSTRY_NOTICE = {
  /** Where these words came from. Name the source with the claim, always. */
  source: "Bitty broker portal → New Applications → Industry — screenshot, 2026-10-30",
  /** Bitty's words, exactly as their form prints them. */
  quotes: [
    "Selecting accurate Industry classification affects your approval. If you enter an inaccurate Industry classification, it can hurt your customer experience or incorrectly decline a deal that should be approved.",
    "Industry can be the difference between 16% commission and an auto-decline.",
  ],
  /** The lookup Bitty themselves name on the form. */
  lookup: "https://www.naics.com/code-search/",
  /** Bitty's own two worked examples, verbatim. */
  examples: [
    "You rush and select “Construction - Commercial” instead of “Plumbing/HVAC”: Deal gets auto-declined instead of approved.",
    "You have deal with “Excavation” in the name and select “Construction - Residential Remodeler” instead of “Site prep contractor”: Deal gets 1.65 paying 10% instead of 1.55 paying 16%.",
  ],
} as const;
