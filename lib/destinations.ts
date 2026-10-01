// The 12 v1 destinations (final per PRD) and their official sources.
// Only official government / embassy pages belong here — nothing else enters the knowledge base.

export type SourceDef = {
  id: string;
  url: string;
  title: string;
  authority: string;
};

export type Destination = {
  id: string;
  name: string;
  region: string;
  aliases: string[];
  // Where to send people when we can't answer from stored sources.
  officialLink: string;
  sources: SourceDef[];
};

export const DESTINATIONS: Destination[] = [
  {
    id: "thailand",
    name: "Thailand",
    region: "Southeast Asia",
    aliases: ["thailand", "thai", "bangkok", "phuket", "pattaya", "krabi", "chiang mai"],
    officialLink: "https://www.thaievisa.go.th/",
    sources: [
      {
        id: "th-embassy-delhi",
        url: "https://newdelhi.thaiembassy.org/en/page/visa",
        title: "Visa",
        authority: "Royal Thai Embassy, New Delhi",
      },
      {
        id: "th-evisa",
        url: "https://www.thaievisa.go.th/",
        title: "Thailand e-Visa portal",
        authority: "Ministry of Foreign Affairs, Thailand",
      },
    ],
  },
  {
    id: "vietnam",
    name: "Vietnam",
    region: "Southeast Asia",
    aliases: ["vietnam", "viet nam", "hanoi", "ho chi minh", "saigon", "da nang", "danang", "hoi an", "phu quoc"],
    officialLink: "https://evisa.gov.vn/",
    sources: [
      {
        id: "vn-evisa",
        url: "https://evisa.gov.vn/",
        title: "Vietnam e-Visa portal",
        authority: "Immigration Department, Vietnam",
      },
    ],
  },
  {
    id: "singapore",
    name: "Singapore",
    region: "Southeast Asia",
    aliases: ["singapore"],
    officialLink: "https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements",
    sources: [
      {
        id: "sg-ica-india",
        url: "https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements/visa-detail-page/india",
        title: "Visa requirements — India",
        authority: "Immigration & Checkpoints Authority, Singapore",
      },
      {
        id: "sg-ica-requirements",
        url: "https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements",
        title: "Visa requirements",
        authority: "Immigration & Checkpoints Authority, Singapore",
      },
    ],
  },
  {
    id: "malaysia",
    name: "Malaysia",
    region: "Southeast Asia",
    aliases: ["malaysia", "kuala lumpur", "langkawi", "penang"],
    officialLink: "https://www.imi.gov.my/index.php/en/main-services/visa/visa-requirement-by-country/",
    sources: [
      {
        id: "my-imi-by-country",
        url: "https://www.imi.gov.my/index.php/en/main-services/visa/visa-requirement-by-country/",
        title: "Visa requirement by country",
        authority: "Immigration Department of Malaysia",
      },
      {
        id: "my-evisa",
        url: "https://malaysiavisa.imi.gov.my/evisa/evisa.jsp",
        title: "Malaysia eVISA",
        authority: "Immigration Department of Malaysia",
      },
    ],
  },
  {
    id: "indonesia",
    name: "Indonesia (Bali)",
    region: "Southeast Asia",
    aliases: ["indonesia", "bali", "jakarta", "lombok", "denpasar"],
    officialLink: "https://evisa.imigrasi.go.id/",
    sources: [
      {
        id: "id-evisa",
        url: "https://evisa.imigrasi.go.id/",
        title: "Indonesia e-Visa portal",
        authority: "Directorate General of Immigration, Indonesia",
      },
    ],
  },
  {
    id: "srilanka",
    name: "Sri Lanka",
    region: "South Asia",
    aliases: ["sri lanka", "srilanka", "colombo", "kandy", "galle"],
    officialLink: "https://www.eta.gov.lk/slvisa/",
    sources: [
      {
        id: "lk-eta",
        url: "https://www.eta.gov.lk/slvisa/",
        title: "Sri Lanka ETA",
        authority: "Department of Immigration & Emigration, Sri Lanka",
      },
      {
        id: "lk-eta-info",
        url: "https://www.eta.gov.lk/slvisa/visainfo/center.jsp?locale=en_US",
        title: "ETA information centre",
        authority: "Department of Immigration & Emigration, Sri Lanka",
      },
    ],
  },
  {
    id: "uae",
    name: "UAE",
    region: "Middle East",
    aliases: ["uae", "u.a.e", "united arab emirates", "emirates", "dubai", "abu dhabi", "sharjah"],
    officialLink: "https://u.ae/en/information-and-services/visa-and-emirates-id/Types-of-visas/Visit-visa",
    sources: [
      {
        id: "ae-visit-visa",
        url: "https://u.ae/en/information-and-services/visa-and-emirates-id/Types-of-visas/Visit-visa",
        title: "Visit visa",
        authority: "UAE Government portal (u.ae)",
      },
      {
        id: "ae-tourist-visa",
        url: "https://u.ae/en/information-and-services/visa-and-emirates-id/Types-of-visas/tourist-visa",
        title: "Tourist visa",
        authority: "UAE Government portal (u.ae)",
      },
    ],
  },
  {
    id: "japan",
    name: "Japan",
    region: "East Asia",
    aliases: ["japan", "japanese", "tokyo", "osaka", "kyoto"],
    officialLink: "https://www.in.emb-japan.go.jp/itpr_en/visa.html",
    sources: [
      {
        id: "jp-embassy-visa",
        url: "https://www.in.emb-japan.go.jp/itpr_en/visa.html",
        title: "Visa information",
        authority: "Embassy of Japan in India",
      },
      {
        id: "jp-mofa-visa",
        url: "https://www.mofa.go.jp/j_info/visit/visa/index.html",
        title: "Visa",
        authority: "Ministry of Foreign Affairs of Japan",
      },
    ],
  },
  {
    id: "schengen",
    name: "Schengen area",
    region: "Europe",
    aliases: [
      "schengen", "europe", "european", "france", "paris", "germany", "berlin", "munich", "italy", "rome",
      "milan", "venice", "spain", "madrid", "barcelona", "netherlands", "amsterdam", "holland", "switzerland",
      "zurich", "geneva", "swiss", "austria", "vienna", "belgium", "brussels", "portugal", "lisbon", "greece",
      "athens", "santorini", "czech", "czechia", "prague", "poland", "hungary", "budapest", "denmark",
      "copenhagen", "sweden", "stockholm", "norway", "oslo", "finland", "helsinki", "iceland", "croatia",
      "slovenia", "slovakia", "estonia", "latvia", "lithuania", "luxembourg", "malta", "liechtenstein",
      "bulgaria", "romania",
    ],
    officialLink: "https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa/visa-policy/applying-schengen-visa_en",
    sources: [
      {
        id: "eu-applying",
        url: "https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa/visa-policy/applying-schengen-visa_en",
        title: "Applying for a Schengen visa",
        authority: "European Commission — Migration and Home Affairs",
      },
      {
        id: "eu-visa-policy",
        url: "https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa/visa-policy_en",
        title: "Visa policy",
        authority: "European Commission — Migration and Home Affairs",
      },
    ],
  },
  {
    id: "uk",
    name: "UK",
    region: "Europe",
    aliases: ["uk", "u.k", "united kingdom", "britain", "great britain", "england", "london", "scotland", "edinburgh", "wales", "manchester"],
    officialLink: "https://www.gov.uk/standard-visitor",
    sources: [
      {
        id: "uk-standard-visitor",
        url: "https://www.gov.uk/standard-visitor",
        title: "Visit the UK as a Standard Visitor",
        authority: "UK Government (GOV.UK)",
      },
      {
        id: "uk-visit-business",
        url: "https://www.gov.uk/standard-visitor/visit-on-business",
        title: "Standard Visitor — visit on business",
        authority: "UK Government (GOV.UK)",
      },
      {
        id: "uk-apply",
        url: "https://www.gov.uk/standard-visitor/apply-standard-visitor-visa",
        title: "Apply for a Standard Visitor visa",
        authority: "UK Government (GOV.UK)",
      },
    ],
  },
  {
    id: "us",
    name: "US",
    region: "Americas and Oceania",
    aliases: ["us", "u.s", "usa", "u.s.a", "united states", "america", "american", "new york", "nyc", "san francisco", "los angeles", "las vegas", "chicago", "b1", "b2", "b1/b2"],
    officialLink: "https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html",
    sources: [
      {
        id: "us-state-visitor",
        url: "https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html",
        title: "Visitor visa",
        authority: "U.S. Department of State",
      },
      {
        id: "us-embassy-india",
        url: "https://in.usembassy.gov/visas/",
        title: "Visas",
        authority: "U.S. Embassy & Consulates in India",
      },
    ],
  },
  {
    id: "australia",
    name: "Australia",
    region: "Americas and Oceania",
    aliases: ["australia", "aussie", "sydney", "melbourne", "brisbane", "perth", "adelaide", "gold coast"],
    officialLink: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600",
    sources: [
      {
        id: "au-visitor-600",
        url: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600",
        title: "Visitor visa (subclass 600)",
        authority: "Department of Home Affairs, Australia",
      },
      {
        id: "au-tourist-stream",
        url: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas",
        title: "Visitor visa — Tourist stream (apply outside Australia)",
        authority: "Department of Home Affairs, Australia",
      },
      {
        id: "au-business-stream",
        url: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/business-visitor-stream",
        title: "Visitor visa — Business Visitor stream",
        authority: "Department of Home Affairs, Australia",
      },
    ],
  },
];

// Common destinations people ask about that v1 does not cover yet.
export const UNCOVERED_DESTINATIONS = [
  "canada", "new zealand", "china", "south korea", "korea", "seoul", "nepal", "bhutan", "maldives", "turkey",
  "turkiye", "istanbul", "egypt", "russia", "mauritius", "qatar", "doha", "saudi", "saudi arabia", "oman",
  "bahrain", "kuwait", "philippines", "cambodia", "laos", "myanmar", "hong kong", "macau", "taiwan",
  "south africa", "kenya", "tanzania", "mexico", "brazil", "argentina", "peru", "ireland", "dublin", "cyprus",
  "georgia", "armenia", "azerbaijan", "kazakhstan", "uzbekistan", "israel", "jordan", "morocco", "seychelles",
  "fiji", "bangladesh", "pakistan",
];

export function getDestination(id: string) {
  return DESTINATIONS.find((d) => d.id === id);
}

export function allSources() {
  return DESTINATIONS.flatMap((d) => d.sources.map((s) => ({ ...s, destinationId: d.id })));
}
