// Municipality configurations for Phase A
// URLs verified 2026-03-16 — all return HTTP 200.

export const municipalities = [
  {
    id: "nacka",
    name: "Nacka",
    platform: "sitevision",
    urls: [
      "https://www.nacka.se/kommun--politik/delta-och-paverka/anslagstavla-officiell/kungorelser/"
    ],
    notes: "Sitevision kommun. URL verified 2026-03-16."
  },
  {
    id: "helsingborg",
    name: "Helsingborg",
    platform: "sitevision",
    urls: [
      "https://anslagstavla.helsingborg.se/"
    ],
    notes: "Dedicated anslagstavla subdomain. URL verified 2026-03-16."
  },
  {
    id: "malmo",
    name: "Malmö",
    platform: "medborgarportal",
    urls: [
      "https://motenmedborgarportal.malmo.se/digital-bulletin-board"
    ],
    notes: "Unified digital anslagstavla portal. URL verified 2026-03-16."
  },
  {
    id: "molndal",
    name: "Mölndal",
    platform: "meetingsplus",
    urls: [
      "https://www.molndal.se/kommun-och-politik/insyn-och-paverkan/anslagstavla"
    ],
    notes: "MeetingsPlus kommun. URL verified 2026-03-16."
  },
  {
    id: "lund",
    name: "Lund",
    platform: "other",
    urls: [
      "https://lund.se/kommun-och-politik/anslagstavla/kungorelser-bygglov"
    ],
    notes: "Dedicated bygglov kungorelser page. URL verified 2026-03-16."
  }
];
