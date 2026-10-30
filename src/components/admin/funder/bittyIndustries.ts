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
