# Floede Engine — Backlog

Långsiktiga punkter som inte är blockerare just nu men ska adresseras.
Nya rader längst ned. Datum vid varje rad.

---

## 2026-05-18 — Subsidiary-bolag sparas felaktigt under moderorg

89/195 NULL_excerpt-rader (alla pre-fix, april 2026) kom från Stockholmshem
(63) och SISAB (26), sparade under `organization_name='Stockholms stad'`.
Dessa är dotterbolag, inte moderorganisationen.

**Konsekvens för CI:** signaler för Stockholmshem hamnar i Fredriks
"Stockholms stad"-kort. Oklart om relevant för honom — feed-noise om
kollegor på Skanska följer specifika dotterbolag.

**Förslag:**
- Antingen separata `ci_organizations`-rader (kan onboardas som egna
  pilot-orgs om relevanta för Skanska eller andra kunder).
- Eller subsidiary-fält på `ci_signals` + `ci_organizations.parent_id`
  som möjliggör drill-down utan att duplicera moderorgens feed.

**Prioritet:** MEDIUM. Inte blockerare för Fredrik (Stockholms stad
fungerar redan), men datakvalitetsfråga som påverkar feed-precision
för dotterbolags-tunga koncerner (Stockholms stad-konstellationen är
störst, troligen liknande för andra kommunala bolag och statliga
moderorgs).

**Domäner att granska:** stockholmshem.se, sisab.se, micasa.se,
familjebostader.se, svenskbostader.se (alla Stockholm), möjligen
fler under SFV/Akademiska Hus om de äger dotterbolag.
