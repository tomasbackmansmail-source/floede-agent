// Standardized Swedish municipality name normalization.
// See docs/aao-standard.md for full specification.
// NFC normalization everywhere. Exception table for 8+2 kommuner.

const EXCEPTIONS = {
  'ängelholm': 'engelholm.se', 'härjedalen': 'herjedalen.se',
  'hällefors': 'hellefors.se', 'stockholm': 'start.stockholm',
  'falun': 'falun.se', 'falu': 'falun.se',
  'mora': 'morakommun.se', 'habo': 'habokommun.se',
  'dals-ed': 'dalsed.se', 'falkenberg': 'kommun.falkenberg.se',
  'värnamo': 'kommun.varnamo.se',
};

/**
 * Normalize a Swedish municipality name to its .se domain hostname.
 * Covers 282/290 kommuner via standard rule. 8+2 exceptions via lookup.
 * Input should be NFC-normalized. Returns e.g. "gavle.se".
 */
export function kommunToDomain(name) {
  const base = name.normalize('NFC').replace(/s$/, '').trim();
  const key = base.toLowerCase();
  if (EXCEPTIONS[key]) return EXCEPTIONS[key];
  const ascii = key
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o')
    .replace(/é/g, 'e').replace(/ü/g, 'u')
    .replace(/\s+/g, '');
  return `${ascii}.se`;
}

/**
 * NFC-normalize + lowercase a municipality name, stripping
 * "kommun"/"stad" suffixes and trailing genitiv-s.
 * Use for name comparison: normalizeMunicipality(a) === normalizeMunicipality(b).
 */
export function normalizeMunicipality(name) {
  return name.normalize('NFC').toLowerCase().trim()
    .replace(/s?\s+kommun$/i, '').replace(/s?\s+stad$/i, '')
    .replace(/s$/, '');
}

/**
 * NFC-normalize + lowercase + replace Swedish characters to ASCII.
 * Removes spaces. Use for hash keys, filename bases, duplicate detection.
 */
export function normalizeToAscii(name) {
  return name.normalize('NFC').toLowerCase()
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o')
    .replace(/é/g, 'e').replace(/ü/g, 'u')
    .replace(/\s+/g, '');
}
