// Health check: verify that daily extraction actually ran and produced data.
// Catches: Railway down, container crash, cron not firing.
// Schedule: Railway cron at 13:30 UTC (15:30 CET) — 30min after expected completion.
//
// Logic: check if permits_v2 has any rows with created_at > today 12:30 UTC (14:30 CET).
// If not, the daily run either didn't start or failed silently.

import { createClient } from "@supabase/supabase-js";

const ALERT_EMAIL = "hej@byggsignal.se";
const ALERT_FROM = "Floede Engine <hej@byggsignal.se>";

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required.");
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Check: any permits created today after 12:30 UTC (= after cron should have started)
  const today = new Date();
  const checkAfter = new Date(today);
  checkAfter.setUTCHours(12, 30, 0, 0);

  // If it's before 13:30 UTC, we're running too early — skip
  if (today < checkAfter) {
    console.log("Too early to check. Cron hasn't run yet.");
    process.exit(0);
  }

  const { count, error } = await supabase
    .from("permits_v2")
    .select("id", { count: "exact", head: true })
    .gte("created_at", checkAfter.toISOString());

  if (error) {
    console.error(`Supabase query failed: ${error.message}`);
    await sendAlert(
      "ALERT: Health check failed — database query error",
      `Could not query permits_v2: ${error.message}\n\nThis may indicate a Supabase outage or credentials issue.`
    );
    process.exit(1);
  }

  console.log(`Permits created after ${checkAfter.toISOString()}: ${count}`);

  if (count === 0) {
    console.log("ALERT: No permits created today. Daily run may not have executed.");
    await sendAlert(
      `ALERT: Floede Engine — no data today (${today.toISOString().slice(0, 10)})`,
      `Health check found 0 new permits in permits_v2 after ${checkAfter.toISOString()}.\n\nThis means the daily extraction either:\n- Did not start (Railway cron failure, container crash)\n- Started but inserted 0 rows (all municipalities failed)\n- Started but hasn't finished yet (unlikely at 15:30 CET)\n\nCheck Railway logs: https://railway.app/project/1532683d-ba9a-405b-83b4-a75d0101d3a0`
    );
  } else {
    console.log(`OK: ${count} permits created today. Engine is healthy.`);
  }
}

async function sendAlert(subject, body) {
  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set — cannot send alert email.");
    console.error(`Would have sent: ${subject}`);
    return;
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ALERT_FROM,
        to: [ALERT_EMAIL],
        subject,
        text: body,
      }),
    });

    if (resp.ok) {
      console.log("Alert email sent.");
    } else {
      console.error(`Alert email failed: ${resp.status} ${await resp.text()}`);
    }
  } catch (err) {
    console.error(`Alert email error: ${err.message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
