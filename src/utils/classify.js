// Generic title-based signal classifier.
// Reads rules from config (vertical-level or per-source) and applies them
// to extracted signals AFTER source_type defaulting. First matching kind wins
// per rule; first matching rule wins overall.
//
// Rule shape:
//   {
//     match_field: "title",
//     set_source_type: "financial_report",
//     kinds: [["arsredovisning", "(?<![a-z])års?redovisning(?![a-z])"], ...]
//   }
//
// On match, mutates signal:
//   - signal[set_source_type_field || "source_type"] = rule.set_source_type
//   - signal.document_kind = matched kind name (used downstream for dedupe)

export function classifySignal(signal, rules) {
  if (!signal || !Array.isArray(rules)) return signal;
  for (const rule of rules) {
    const value = signal[rule.match_field];
    if (!value || typeof value !== "string") continue;
    for (const entry of rule.kinds || []) {
      const [kind, pattern] = entry;
      let re;
      try {
        re = new RegExp(pattern, "i");
      } catch {
        continue;
      }
      if (re.test(value)) {
        if (rule.set_source_type) signal.source_type = rule.set_source_type;
        signal.document_kind = kind;
        return signal;
      }
    }
  }
  return signal;
}
