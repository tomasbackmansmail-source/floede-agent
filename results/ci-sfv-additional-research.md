# Statens fastighetsverk — Ytterligare kallor

**Datum:** 2026-04-01
**Vertikal:** ci-pressroom (Client Intelligence)
**Befintlig kalla:** Cision (news.cision.com/se/statens-fastighetsverk, needs_browser=true)
**Befintliga signaler:** 6

---

## Undersokta kallor

### se.openprocurements.com — SFV upphandlingsarkiv
- **URL:** https://se.openprocurements.com/buyer/statens-fastighetsverk/
- **Extraherbarhet:** 2 (statisk HTML, paginering)
- **Status:** INAKTUELL — senaste post 2023-10-16
- **Mervarde:** Historiska awarded-signaler med leverantorsnamn. Inte lopande.

### mercell.com — SFV aktiva upphandlingar
- **URL:** https://www.mercell.com/sv-se/upphandling/16603489/statens-fastighetsverk-upphandlingar.aspx
- **Extraherbarhet:** 4 (kraver Playwright, ASP.NET)
- **Status:** AKTIV — 16 upphandlingar vid analystillfallet
- **Mervarde:** Unika tender-signaler som Cision saknar. Kraver Playwright.

### sfv.se/om-oss/nyheterpress/ — SFV nyhetssida
- **Extraherbarhet:** 4 (Next.js, kraver Playwright)
- **Mervarde:** Duplicerar Cision. Inget tillskott.

### sfv.se/vara-fastigheter/byggprojekt/ — Projektlista
- **Extraherbarhet:** 4 (Next.js, redan identifierad, ej godkand)
- **Mervarde:** Projektnamn och status. Kraver Playwright.

### Mynewsdesk — SFV
- **Status:** 404. SFV lamnade Mynewsdesk ~2010.

### Riksrevisionen — granskningsrapport 2025
- **Extraherbarhet:** 1 (statisk HTML)
- **Mervarde:** Aggregerade investeringssiffror (1,8 mdr/ar). Engangsdokument, inte lopande.

---

## Slutsats

**Inga nya kallor implementeras.** Alla alternativ ar antingen:
- Inaktuella (openprocurements)
- Kraver Playwright (mercell, sfv.se)
- Duplicerar Cision (sfv.se/nyheter)
- Engangsdokument (Riksrevisionen)

SFV har bra tackning via befintlig Cision-kalla (6 signaler, bade planned och awarded).

**Rekommendation for framtiden:**
- mercell.com ar vard att implementera i en Playwright-fas (unika tender-signaler)
- sfv.se/byggprojekt likaså (projektlista med status)
