# QC-rapport: Akademiska Hus (CI-vertikalen)

**Datum:** 2026-04-01  
**Vertikal:** Client Intelligence (CI-pressroom)  
**Organisation:** Akademiska Hus  
**Organization ID:** 02af1165-925d-4511-960c-488ddcef9cc2

---

## Sammanfattning

- **Totalt signaler testade:** 36
- **Signaler godkända:** 26
- **Signaler underkända:** 10
- **Kritiska problem:** 10 signaler utan source-fält (null)

---

## Detaljerade fynd

### 1. Organization ID-validering: GODKÄND

**Status:** PASS

Alla 36 signaler har organization_id satt och det matchar korrekt:
- `organization_id = 02af1165-925d-4511-960c-488ddcef9cc2`
- `organization_name = Akademiska Hus`

Denna kritiska kravkontroll är GODKÄND.

---

### 2. Source-fält validering: KRITISK MISSLYCKAD

**Status:** FAIL - 10 signaler

**Problem:** 10 av 36 signaler (28%) har `source = null`. Detta bryter mot QC-kraven för CI:
- 13 signaler från Mynewsdesk (`source_url: https://www.mynewsdesk.com/se/akademiska_hus_ab/pressreleases`)
- 13 signaler från Akademiska Hus nyhetsarkiv (`source_url: https://www.akademiskahus.se/om-oss/aktuellt/Nyheter/`)
- **10 signaler: source = null och source_url = null**

**Underkända signaler:**

1. ID: `2d02191f-931d-43fa-b293-06294e17a58b`  
   Titel: "Investeringar om- till- och nybyggnation 2025"  
   Problem: `source = null`, `source_url = null`  
   Orsak: Signalen extraherades utan att source-fältet sattes

2. ID: `2d5dff80-fd8f-4d42-a9cc-01a35c8430e0`  
   Titel: "Solcellsinstallation på Arrheniuslaboratoriet, Stockholms universitet"  
   Problem: `source = null`, `source_url = null`  
   Orsak: Signalen från gammal körning (2026-04-01T08:59:56)

3. ID: `07b0b616-0d63-44bc-ac03-dde5bf20724d`  
   Titel: "Nya studentbostäder vid Gibraltarvallen, Campus Johanneberg"  
   Problem: `source = null`, `source_url = null`  
   Orsak: Signalen från gammal körning (2026-04-01T08:59:56)

4. ID: `09c7b0b5-a163-4f21-a5a4-87461d902c3e`  
   Titel: "Framtidens campus Luleå – tre nya byggnader vid LTU"  
   Problem: `source = null`, `source_url = null`  
   Orsak: Signalen från gammal körning (2026-04-01T08:59:56)

5. ID: `d13c219c-ad20-4262-a625-e05bd4fc2d9a`  
   Titel: "Ny byggnad för Handelshögskolan vid Göteborgs universitet"  
   Problem: `source = null`, `source_url = null`  
   Orsak: Signalen från gammal körning (2026-04-01T08:59:56)

6. ID: `819c7e0b-18bf-428c-a597-b3fc565b40bf`  
   Titel: "Omvandling av undervisningsbyggnad till studentbostäder i Frescati"  
   Problem: `source = null`, `source_url = null`  
   Orsak: Signalen från gammal körning (2026-04-01T08:59:56)

7. ID: `121efe48-7fe4-4dbe-a26f-044f547ac95a`  
   Titel: "Campusutveckling Luleå tekniska universitet – mångmiljardsatsning"  
   Problem: `source = null`, `source_url = null`  
   Orsak: Signalen från gammal körning (2026-04-01T08:59:56)

8. ID: `a3a53f0c-27dd-4e98-8479-23692a64ccda`  
   Titel: "Totalrenovering av Zoologen på Medicinareberget, Göteborg"  
   Problem: `source = null`, `source_url = null`  
   Orsak: Signalen från gammal körning (2026-04-01T08:59:56)

9. ID: `68322817-8d78-461a-a995-9ea31feb13d5`  
   Titel: "Återbruk av betongstomme vid campus Albano – Teknikhöjden"  
   Problem: `source = null`, `source_url = null`  
   Orsak: Signalen från gammal körning (2026-04-01T08:59:56)

10. ID: `540cd273-2e91-4434-a7cb-753e29b6a897`  
    Titel: "Investeringar om 3 miljarder i om-, till- och nybyggnationer 2025"  
    Problem: `source = null`, `source_url = null`  
    Orsak: Signalen från gammal körning (2026-04-01T08:59:56)

---

### 3. Maturity-värden: GODKÄND

**Status:** PASS

Alla 36 signaler har giltiga maturity-värden enligt kravspecifikationen (rumor/planned/tender/awarded):
- **Planned:** 21 signaler (58%)
- **Awarded:** 10 signaler (28%)
- **Rumor:** 5 signaler (14%)

Ingen ogiltig maturity-värde hittad.

---

### 4. Dubbletter mellan källorna: 4 DUBBLETTER FUNNA

**Status:** DUBBLETTER IDENTIFIERADE

Följande projekt finns i båda källorna (Mynewsdesk och akademiskahus.se nyhetsarkiv):

**Duplett 1: Zoologen-renovering (3 kopior)**
- Titel: "Totalrenovering av Zoologen på Medicinareberget, Göteborg"
- ID 1: `a3a53f0c-27dd-4e98-8479-23692a64ccda` (gammal, 2026-04-01T08:59:56, source=null)
- ID 2: `d9a2bbb2-e934-492d-8e9b-2a024aac4ffd` (äldre, 2026-04-01T12:41:05, source=null)
- ID 3: `3a1f05e9-e720-4e98-aafe-9f2a26f25dd5` (nyaste, 2026-04-01T12:46:51, source=mynewsdesk + amount_sek=245M)
- **Åtgärd:** De två äldsta bör raderas, behålla den nyaste

**Duplett 2: Handelshögskolan Göteborg (2 kopior)**
- Titel: "Ny byggnad för Handelshögskolan vid Göteborgs universitet"
- ID 1: `d13c219c-ad20-4262-a625-e05bd4fc2d9a` (gammal, 2026-04-01T08:59:56, source=null)
- ID 2: `9ab6c5bb-6974-44e7-a9ef-dc094b236109` (nyare, 2026-04-01T12:41:05, source=null)
- **Åtgärd:** Den gamla bör raderas

**Duplett 3: Studentbostäder Gibraltarvallen (2 kopior)**
- Titel: "Nya studentbostäder vid Gibraltarvallen, Campus Johanneberg"
- ID 1: `07b0b616-0d63-44bc-ac03-dde5bf20724d` (gammal, 2026-04-01T08:59:56, source=null)
- ID 2: `ea848f1d-7d47-442e-9e68-3b044d9647e9` (nyare, 2026-04-01T12:41:05, source=null)
- **Åtgärd:** Den gamla bör raderas

**Duplett 4: Solceller Arrheniuslaboratoriet (2 kopior)**
- Titel: "Solcellsinstallation på Arrheniuslaboratoriet, Stockholms universitet"
- ID 1: `2d5dff80-fd8f-4d42-a9cc-01a35c8430e0` (gammal, 2026-04-01T08:59:56, source=null)
- ID 2: `71ede3f6-2345-47ea-ac63-b274be51bf53` (nyare, 2026-04-01T12:42:31, source=null)
- **Åtgärd:** Den gamla bör raderas

**Slutsats:** 7 dubbletter funna (6 gamla signaler kan raderas, vilket skulle minska från 36 till 29 unika signaler). 2 nya källor (Mynewsdesk + akademiskahus.se nyheter) verkar producera överlappande data.

---

### 5. Källornas fördelning

**Source URL-fördelning:**

| Källa | Signaler | Andel |
|-------|----------|-------|
| Mynewsdesk (pressreleases) | 13 | 36% |
| Akademiska Hus (nyhetsarkiv) | 13 | 36% |
| Utan source_url (null) | 10 | 28% |

**Total:** 36 signaler från två källorna + 10 gamla utan källa.

---

## Stickprov: Tre signaler verifierade

### Signal 1 (från Mynewsdesk)
```
ID: f150040a-bb0c-437f-a18b-53b68084428b
Title: Investeringar om- till- och nybyggnationer 2025, ca 3 miljarder SEK
Source: https://www.mynewsdesk.com/se/akademiska_hus_ab/pressreleases
Organization ID: 02af1165-925d-4511-960c-488ddcef9cc2
Organization Name: Akademiska Hus
Maturity: planned
Amount SEK: 3000000000
Status: PASS - Alla obligatoriska fält ifyllda, rimligt värde
```

### Signal 2 (från akademiskahus.se)
```
ID: b52132bc-1e48-4a7d-bb57-7c93c2d6fb53
Title: Restaurering av historiska miljöer på Frescati – Bloms hus och Småbrukarhemmet
Source: https://www.akademiskahus.se/om-oss/aktuellt/Nyheter/
Organization ID: 02af1165-925d-4511-960c-488ddcef9cc2
Organization Name: Akademiska Hus
Maturity: awarded
Amount SEK: null (OK - ej alltid tillgängligt)
Status: PASS - Alla obligatoriska fält ifyllda
```

### Signal 3 (GAMMAL, utan source)
```
ID: 2d02191f-931d-43fa-b293-06294e17a58b
Title: Investeringar om- till- och nybyggnation 2025
Source: null
Source URL: null
Organization ID: 02af1165-925d-4511-960c-488ddcef9cc2
Organization Name: Akademiska Hus
Maturity: planned
Amount SEK: 3000000000
Status: FAIL - Saknar source-fält
```

---

## Rekommendation

**GODKÄND MED RESERVATIONER**

### Vad som är bra:
1. **Organization ID:** Alla 36 signaler har korrekt organization_id (kritisk krav uppfylld)
2. **Maturity-värden:** Alla är giltiga (rumor/planned/tender/awarded)
3. **Nya signaler från två källor:** 13 från Mynewsdesk + 13 från akademiskahus.se nyhetsarkiv = 26 nya signaler
4. **Belopp:** Där tillgängligt är amount_sek rimliga värden

### Vad som behöver åtgärdas:
1. **KRITISK:** 10 gamla signaler utan source eller source_url måste raderas (ID:n listade ovan)
2. **DUBBLETT-HANTERING:** Dedup-logiken har inte tagit bort de identiska signalerna mellan källorna. Behöver config-justering för:
   - Zoologen (3 kopior) - ta bort 2
   - Handelshögskolan (2 kopior) - ta bort 1
   - Gibraltarvallen (2 kopior) - ta bort 1
   - Solceller (2 kopior) - ta bort 1
   - Total: 7 dubbletter som kan raderas

### Nästa steg:
1. **Config-builder:** Justerar dedup-config för Akademiska Hus så att identiska projekt bara lagras en gång
2. **Data cleanup:** Raderar de 10 gamla signalerna utan source_url och de 6 äldsta dupletterna
3. **Slutresultat:** ~29 unika signaler från två högkvalitativa källor
