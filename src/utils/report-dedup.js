// Report-style dedupe across signals that share (match_fields + kind).
//
// Use case: financial reports are often re-published across channels with
// different URLs and slightly different titles (e.g. "Bokslutskommuniké 2025"
// from a press release + "Vasakronans bokslutskommuniké 2025" from Cision).
// They share organization_id, source_date and document_kind — that triple is
// the natural dedupe key.
//
// document_kind is computed by signal_classifier_rules and persisted to
// structured_meta.<kind_field> at insert time, so we can compare in SQL.
//
// Config shape:
//   report_dedup: {
//     applies_to_source_type: "financial_report",
//     match_fields: ["organization_id", "source_date"],
//     kind_field: "document_kind",          // path inside structured_meta
//     kind_column: "structured_meta"        // optional, defaults to structured_meta
//   }

export function isReportDedupConfig(cfg) {
  return !!cfg
    && typeof cfg.applies_to_source_type === "string"
    && Array.isArray(cfg.match_fields)
    && cfg.match_fields.length > 0
    && typeof cfg.kind_field === "string";
}

export async function findReportDuplicate(supabase, table, row, kind, config) {
  if (!isReportDedupConfig(config)) return null;
  if (!kind) return null;

  const matchValues = {};
  for (const f of config.match_fields) {
    if (!row[f]) return null;
    matchValues[f] = row[f];
  }

  const kindColumn = config.kind_column || "structured_meta";

  let query = supabase
    .from(table)
    .select(`id, ${kindColumn}, title`)
    .eq("source_type", config.applies_to_source_type);

  for (const [f, v] of Object.entries(matchValues)) {
    query = query.eq(f, v);
  }

  const { data, error } = await query;
  if (error || !data) return null;

  for (const r of data) {
    const existingKind = r[kindColumn]?.[config.kind_field];
    if (existingKind === kind) return r.id;
  }
  return null;
}
