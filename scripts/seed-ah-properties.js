// scripts/seed-ah-properties.js — Insert Akademiska Hus properties into ci_properties
// Run: node --env-file=.env scripts/seed-ah-properties.js

import { readFileSync } from 'node:fs';

const CI_SUPABASE_URL = 'https://qvmthuylldpzcoyzryqe.supabase.co';
const CI_SUPABASE_KEY = process.env.CI_SUPABASE_SERVICE_KEY;

if (!CI_SUPABASE_KEY) {
  console.error('Missing CI_SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const headers = {
  apikey: CI_SUPABASE_KEY,
  Authorization: `Bearer ${CI_SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// All properties extracted from Akademiska Hus Fastighetsförteckning 2025 PDF
// Unique (property_designation, municipality) pairs
const properties = [
  // LUND (A)
  { property_designation: 'Paradis 51', municipality: 'Lund' },
  { property_designation: 'Paradis 47', municipality: 'Lund' },
  { property_designation: 'Absalon 5', municipality: 'Lund' },
  { property_designation: 'Hyphoff 5', municipality: 'Lund' },
  { property_designation: 'Saxo 3', municipality: 'Lund' },
  { property_designation: 'Sölve 1', municipality: 'Lund' },
  { property_designation: 'Eskil 21', municipality: 'Lund' },
  { property_designation: 'Helgonagården 6:16', municipality: 'Lund' },
  { property_designation: 'Studentkåren 4', municipality: 'Lund' },
  // Malmö (under Lund-sektionen)
  { property_designation: 'Klerken 4', municipality: 'Malmö' },
  // Alnarp
  { property_designation: 'Alnarp 1:60', municipality: 'Alnarp' },
  { property_designation: 'Alnarp 1:63', municipality: 'Alnarp' },
  { property_designation: 'Alnarp 1:64', municipality: 'Alnarp' },
  // GÖTEBORG (C)
  { property_designation: 'Lorensberg 21:1', municipality: 'Göteborg' },
  { property_designation: 'Lorensberg 24:3', municipality: 'Göteborg' },
  { property_designation: 'Vasastaden 12:19', municipality: 'Göteborg' },
  { property_designation: 'Haga 22:1', municipality: 'Göteborg' },
  { property_designation: 'Haga 21:19', municipality: 'Göteborg' },
  { property_designation: 'Annedal 20:2', municipality: 'Göteborg' },
  { property_designation: 'Annedal 21:11', municipality: 'Göteborg' },
  // GÖTEBORG CHALMERS (D)
  { property_designation: 'Johanneberg 31:9', municipality: 'Göteborg' },
  { property_designation: 'Krokslätt 109:20, 110:3', municipality: 'Göteborg' },
  // GÖTEBORG MEDICINAREBERGET (E)
  { property_designation: 'Änggården 718:138', municipality: 'Göteborg' },
  // GÖTEBORG ÖVRIGT
  { property_designation: 'Balder 7', municipality: 'Borås' },
  { property_designation: 'Sandgärdet 6 m.fl.', municipality: 'Borås' },
  { property_designation: 'Korsnäs 1:16', municipality: 'Strömstad' },
  { property_designation: 'Lysekil Skaftö-Fiskebäck 1:556', municipality: 'Fiskebäckskil' },
  { property_designation: 'Skaftö-Fiskebäck 1:500', municipality: 'Fiskebäckskil' },
  // KARLSTAD (F)
  { property_designation: 'Karlstad Universitetet 1', municipality: 'Karlstad' },
  // SKÖVDE
  { property_designation: 'Göta 1', municipality: 'Skövde' },
  // LINKÖPING (G)
  { property_designation: 'Intellektet 1', municipality: 'Linköping' },
  // ÖREBRO (H)
  { property_designation: 'Örebro Universitetet 1', municipality: 'Örebro' },
  { property_designation: 'Grythyttan 6:419', municipality: 'Grythyttan' },
  // NORRKÖPING (I)
  { property_designation: 'Kåkenhus 11', municipality: 'Norrköping' },
  { property_designation: 'Täppan 23', municipality: 'Norrköping' },
  { property_designation: 'Kopparhammaren 6', municipality: 'Norrköping' },
  // STOCKHOLM (J)
  { property_designation: 'Norra Djurgården 1:45', municipality: 'Stockholm' },
  { property_designation: 'Norra Djurgården 1:44', municipality: 'Stockholm' },
  { property_designation: 'Kattrumpstullen 7', municipality: 'Stockholm' },
  { property_designation: 'Kattrumpstullen 8', municipality: 'Stockholm' },
  { property_designation: 'Teknikhöjden 1', municipality: 'Stockholm' },
  { property_designation: 'Kungstenen 4', municipality: 'Stockholm' },
  { property_designation: 'Svea Artilleri 12', municipality: 'Stockholm' },
  // CAMPUS SOLNA (K)
  { property_designation: 'Haga 4:35', municipality: 'Solna' },
  // CAMPUS HUDDINGE (L)
  { property_designation: 'Medicinaren 4', municipality: 'Huddinge' },
  { property_designation: 'Embryot 1', municipality: 'Huddinge' },
  // STOCKHOLM FRESCATI (M)
  { property_designation: 'Norra Djurgården 1:48', municipality: 'Stockholm' },
  { property_designation: 'Askö 1:4', municipality: 'Trosa' },
  // KTH CAMPUS (N)
  { property_designation: 'Maskiningenjören 1', municipality: 'Stockholm' },
  { property_designation: 'Norra Djurgården 1:49', municipality: 'Stockholm' },
  { property_designation: 'Röda Korset 1', municipality: 'Stockholm' },
  { property_designation: 'Idrottshögskolan 1', municipality: 'Stockholm' },
  { property_designation: 'Forskningen 1', municipality: 'Stockholm' },
  { property_designation: 'Kattrumpstullen 1', municipality: 'Stockholm' },
  { property_designation: 'Kattrumpstullen 10', municipality: 'Stockholm' },
  // KISTA (O)
  { property_designation: 'Keflavik 2', municipality: 'Kista' },
  // UPPSALA (P)
  { property_designation: 'Luthagen 62:7', municipality: 'Uppsala' },
  { property_designation: 'Kåbo 14:3', municipality: 'Uppsala' },
  { property_designation: 'Kåbo 1:20', municipality: 'Uppsala' },
  { property_designation: 'Kronåsen 7:1', municipality: 'Uppsala' },
  // UPPSALA (Q)
  { property_designation: 'Kåbo 5:1', municipality: 'Uppsala' },
  { property_designation: 'Kåbo 5:4', municipality: 'Uppsala' },
  { property_designation: 'Kåbo 34:12', municipality: 'Uppsala' },
  { property_designation: 'Kåbo 1:10', municipality: 'Uppsala' },
  { property_designation: 'Kåbo 5:9', municipality: 'Uppsala' },
  // UPPSALA CAMPUS ULTUNA (R)
  { property_designation: 'Ultuna 2:23', municipality: 'Uppsala' },
  { property_designation: 'Ultuna 2:15', municipality: 'Uppsala' },
  // GÄVLE (S)
  { property_designation: 'Kungsbäck 2:8', municipality: 'Gävle' },
  // UMEÅ (T)
  { property_designation: 'Stadsliden 6:6', municipality: 'Umeå' },
  { property_designation: 'Norrbyn 2:122', municipality: 'Hörnefors' },
  // LULEÅ (U)
  { property_designation: 'Porsön 1:405', municipality: 'Luleå' },
];

async function main() {
  // 1. Get Akademiska Hus organization_id
  const orgUrl = `${CI_SUPABASE_URL}/rest/v1/ci_organizations?name=eq.Akademiska%20Hus&select=id,name`;
  const orgRes = await fetch(orgUrl, { headers });
  if (!orgRes.ok) throw new Error(`Failed to fetch org: ${orgRes.status}`);
  const orgs = await orgRes.json();

  if (orgs.length === 0) {
    console.error('Akademiska Hus not found in ci_organizations');
    process.exit(1);
  }

  const orgId = orgs[0].id;
  console.log(`Found Akademiska Hus with id: ${orgId}`);

  // 2. Insert properties
  const rows = properties.map((p) => ({
    organization_id: orgId,
    property_designation: p.property_designation,
    municipality: p.municipality,
  }));

  console.log(`Inserting ${rows.length} properties...`);

  const insertUrl = `${CI_SUPABASE_URL}/rest/v1/ci_properties`;
  const res = await fetch(insertUrl, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Insert failed: ${res.status} ${body}`);
    process.exit(1);
  }

  const inserted = await res.json();
  console.log(`Successfully inserted/upserted ${inserted.length} properties`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
