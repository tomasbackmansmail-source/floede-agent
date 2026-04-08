# Motorinsikter — april 2026

Dokumenterar vad vi lärde oss när vi gick från 246 till 272 kommuner på 3 dagar.

## Principer (obligatoriska för alla framtida motorarbete)

### 1. Fas 0 slår allt
Sök alltid efter befintliga register och aggregatorer INNAN agentisk discovery. Villaägarnas register hade 290 verifierade URL:er. Vi hittade det på 2 sekunder via Google — motorn spenderade 4 veckor på att göra samma sak sämre.

### 2. Adaptrar före scraping
Innan du scrapar HTML: kolla om plattformen har ett API. Ciceron, MeetingPlus och NetPublicator har alla öppna API:er som ger strukturerad data utan LLM. 31 kommuner körs nu med $0 LLM-kostnad per dag.

### 3. Discovery måste navigera webben
Hela internet är byggt med menyer, sökfält och filter. Discovery som bara testar URL:er är blind mot moderna webbapplikationer. interactWithPage() löser detta: Playwright laddar sidan, LLM analyserar DOM, identifierar filter, testar search_terms, extraherar data.

### 4. Aldrig manuell seedning utan verifiering
Varje ny källa körs genom discovery-pipelinen: discovery → verify → approve → extract. Aldrig hoppa över steg. Vi seedade 290 URL:er utan verifiering — 46 pekade på fel sida.

### 5. Mät med SQL, inte antaganden
Namnproblem ("Eslövs kommun" vs "Eslöv") dolde 28 kommuner. Vi trodde vi hade 246 men hade 262. Varje påstående om täckning verifieras mot databasen.

### 6. Läs loggar, inte statusikoner
Railway visar grön status även när allt inuti failar. CI saknade miljövariabler sedan start — aldrig kört autonomt. Resend-avsändaren var fel — statusmail levererades aldrig. Ingen märkte det.

### 7. Plan Mode för motorändringar
Alla kodändringar i floede-agent börjar med `claude --permission-mode plan`. Plan Mode tvingar CC att läsa kodbasen, ställa frågor, och producera en plan innan en rad kod ändras.

### 8. Content hashing
Första körningen med nya configs triggar alltid full LLM-extraction. Hasharna sparas vid lyckad extraction. Efterföljande körningar kostar $0 om sidan inte ändrats. Förväntat beteende, inte en bugg.

### 9. Discovery måste följa externa länkar
Kommunernas info-sidor pekar ofta på externa anslagstavlor (NetPublicator, MeetingPlus). Discovery som bara testar URL:er på kommunens egen domän missar alla externa plattformar.

### 10. Motorn var rätt — vi använde den fel
Discovery-pipelinen, search_terms, Sonnet-eskalering — allt fanns. Vi hoppade över det. Det viktigaste vi lärde oss: motorn måste köras som designat.
