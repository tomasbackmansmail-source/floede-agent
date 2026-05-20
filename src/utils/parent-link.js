// Generic parent-child linking between signals across pipeline runs.
//
// Config shape (per vertical):
//   parent_link: {
//     child_source_type: "annual_report",
//     parent_source_type: "financial_report",
//     match_field: "organization_id",
//     date_field: "source_date",
//     window_days: 7,
//     parent_id_column: "parent_signal_id"  // optional, defaults to parent_signal_id
//   }
//
// Two operations:
// - findParentSignalId: called before insert of a CHILD. Looks up a parent
//   within ±window_days; returns closest-in-time id or null.
// - findOrphanChildIds: called after insert of a PARENT. Returns child ids
//   with NULL parent_id_column within ±window_days that should be linked back.

export function isParentLinkConfig(cfg) {
  return !!cfg
    && typeof cfg.parent_source_type === "string"
    && typeof cfg.child_source_type === "string"
    && typeof cfg.match_field === "string"
    && typeof cfg.date_field === "string"
    && typeof cfg.window_days === "number";
}

function dateRange(dateStr, windowDays) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const lo = new Date(date);
  lo.setUTCDate(date.getUTCDate() - windowDays);
  const hi = new Date(date);
  hi.setUTCDate(date.getUTCDate() + windowDays);
  return {
    target: date.getTime(),
    lower: lo.toISOString().slice(0, 10),
    upper: hi.toISOString().slice(0, 10),
  };
}

function pickClosest(rows, target, dateField) {
  return rows.slice().sort((a, b) =>
    Math.abs(new Date(a[dateField]).getTime() - target) -
    Math.abs(new Date(b[dateField]).getTime() - target)
  )[0];
}

export async function findParentSignalId(supabase, table, record, config) {
  if (!isParentLinkConfig(config)) return null;
  if (record.source_type !== config.child_source_type) return null;

  const matchValue = record[config.match_field];
  const dateValue = record[config.date_field];
  if (!matchValue || !dateValue) return null;

  const range = dateRange(dateValue, config.window_days);
  if (!range) return null;

  const { data, error } = await supabase
    .from(table)
    .select(`id, ${config.date_field}`)
    .eq("source_type", config.parent_source_type)
    .eq(config.match_field, matchValue)
    .gte(config.date_field, range.lower)
    .lte(config.date_field, range.upper);

  if (error || !data || data.length === 0) return null;

  const closest = pickClosest(data, range.target, config.date_field);
  return closest?.id || null;
}

export async function findOrphanChildIds(supabase, table, parentRecord, parentId, config) {
  if (!isParentLinkConfig(config)) return [];
  if (parentRecord.source_type !== config.parent_source_type) return [];
  if (!parentId) return [];

  const matchValue = parentRecord[config.match_field];
  const dateValue = parentRecord[config.date_field];
  if (!matchValue || !dateValue) return [];

  const range = dateRange(dateValue, config.window_days);
  if (!range) return [];

  const parentIdColumn = config.parent_id_column || "parent_signal_id";

  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("source_type", config.child_source_type)
    .eq(config.match_field, matchValue)
    .is(parentIdColumn, null)
    .gte(config.date_field, range.lower)
    .lte(config.date_field, range.upper);

  if (error || !data) return [];
  return data.map(r => r.id);
}
