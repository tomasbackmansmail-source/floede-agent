// Expected extraction results per fixture.
// These define what a correct extraction SHOULD produce.
// Used by snapshot tests to verify Haiku output.

export const EXPECTED = {
  "01-sitevision-inline": {
    municipality: "Karlstad",
    min_permits: 5,
    max_permits: 5,
    expected_permits: [
      { case_number: "BN 2026/0234", permit_type: "bygglov", status: "beviljat", applicant: "Karlstad Bostäder AB" },
      { case_number: "BN 2026/0198", permit_type: "marklov", status: "beviljat", applicant: null },  // Anna Johansson = privatperson
      { case_number: "BN 2026/0211", permit_type: "rivningslov", status: "beviljat", applicant: "Stiftelsen Karlstadshus" },
      { case_number: "BN 2025/1456", permit_type: "bygglov", status: "startbesked", applicant: null },  // Erik Svensson = privatperson
      { case_number: "BN 2026/0089", permit_type: "förhandsbesked", status: "beviljat", applicant: "BRF Alstervik" },
    ],
  },

  "02-episerver-table": {
    municipality: "Eskilstuna",
    min_permits: 4,
    max_permits: 4,
    expected_permits: [
      { case_number: "SBN/2026/00321", permit_type: "bygglov", status: "beviljat" },
      { case_number: "SBN/2026/00287", permit_type: "anmälan", status: "startbesked" },
      { case_number: "SBN/2026/00256", permit_type: "strandskyddsdispens", status: "beviljat" },
      { case_number: "SBN/2025/01987", permit_type: "bygglov", status: "avslag" },
    ],
  },

  "03-netpublicator-articles": {
    municipality: "Malmö",
    min_permits: 3,
    max_permits: 3,
    expected_permits: [
      { case_number: "BN-2026-00789", permit_type: "bygglov", status: "beviljat", applicant: "MKB Fastighets AB" },
      { case_number: "BN-2026-00812", permit_type: "bygglov", status: "ansökt", applicant: "Wihlborgs Fastigheter AB" },
      { case_number: "BN-2026-00756", permit_type: "bygglov", status: "beviljat", applicant: null },  // Lars Petersson = privatperson
    ],
  },

  "04-wordpress-blocks": {
    municipality: "Lund",
    min_permits: 4,
    max_permits: 4,
    expected_permits: [
      { case_number: "BN 2026/0456", permit_type: "bygglov", status: "beviljat", applicant: "KB Lundafastigheter" },
      { case_number: "BN 2026/0423", permit_type: "bygglov", status: "beviljat", applicant: "Lunds Kommuns Fastighets AB" },
      { case_number: "BN 2026/0401", permit_type: "förhandsbesked", status: "ansökt", applicant: null },  // Maria Andersson
      { case_number: "BN 2025/0890", permit_type: "bygglov", status: "slutbesked", applicant: "HB Genarps Industri" },
    ],
  },

  "05-sitevision-subpages": {
    municipality: "Nacka",
    min_permits: 3,
    max_permits: 3,
    expected_permits: [
      { case_number: "KFKS 2026/00142", permit_type: "bygglov", status: "beviljat", applicant: null },  // Peter Lindqvist
      { case_number: "KFKS 2026/00156", permit_type: "bygglov", status: "beviljat", applicant: "BRF Orminge Centrum" },
      { case_number: "KFKS 2026/00163", permit_type: "bygglov", status: "startbesked", applicant: "Nacka Exploatering AB" },
    ],
  },

  "06-meetingsplus-details": {
    municipality: "Mölndal",
    min_permits: 5,
    max_permits: 5,
    expected_permits: [
      { case_number: "BN 2026/00123", permit_type: "bygglov", status: "beviljat" },
      { case_number: "BN 2026/00098", permit_type: "bygglov", status: "beviljat", applicant: "Lindome Fastigheter AB" },
      { case_number: "BN 2026/00112", permit_type: "bygglov", status: "avslag" },
      { case_number: "BN 2026/00134", permit_type: "anmälan", status: "startbesked" },
      { case_number: "BN 2026/00145", permit_type: "anmälan", status: "startbesked" },
    ],
  },

  "07-municipio-cards": {
    municipality: "Helsingborg",
    min_permits: 3,
    max_permits: 3,
    expected_permits: [
      { case_number: "BN-2026-234", permit_type: "bygglov", status: "beviljat", applicant: "Helsingborgshem AB" },
      { case_number: "BN-2026-219", permit_type: "bygglov", status: "beviljat" },
      { case_number: "BN-2025-1567", permit_type: "bygglov", status: "överklagat", applicant: "Peab Bostad AB" },
    ],
  },

  "08-custom-mixed-types": {
    municipality: "Gotland",
    min_permits: 4,
    max_permits: 4,
    expected_permits: [
      { case_number: "MN 2026/0078", permit_type: "strandskyddsdispens", status: "beviljat", applicant: "Gotlands Hamnförening" },
      { case_number: "BN 2026/0345", permit_type: "bygglov", status: "beviljat", applicant: "Gotlands Energi AB" },
      { case_number: "BN 2026/0312", permit_type: "anmälan", status: "startbesked" },
      { case_number: "BN 2026/0298", permit_type: "marklov", status: "beviljat" },
    ],
  },

  "09-empty-no-permits": {
    municipality: "Tibro",
    min_permits: 0,
    max_permits: 0,
    expected_permits: [],
  },

  "10-gdpr-applicants": {
    municipality: "Uppsala",
    min_permits: 4,
    max_permits: 4,
    expected_permits: [
      { case_number: "2026-000456", permit_type: "bygglov", status: "beviljat", applicant: null },  // Johan Erik Bergström = privatperson
      { case_number: "2026-000478", permit_type: "bygglov", status: "beviljat", applicant: "Uppsala Bostadsförening" },
      { case_number: "2026-000445", permit_type: "rivningslov", status: "beviljat", applicant: null },  // Lisa Maria Johansson-Pettersson
      { case_number: "2026-000490", permit_type: "bygglov", status: "ansökt", applicant: "Akademiska Hus AB" },
    ],
  },
};
