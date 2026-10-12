# Prompt till Claude Cowork – exempelfiler för MB Stats

Klistra in allt under strecket i Claude Cowork på Karims dator.

---

Uppdrag: Ta fram exempelfiler till statistikappen MB Stats.

Spara allt i OneDrive-mappen Dokument/MB Puls/exempeldata/ (skapa den). Lägg INGET i Obsidian-valvet: valvet synkas till GitHub och filerna innehåller personuppgifter.

Regler

- Bara läsa och exportera. Ändra, attestera, skicka eller radera ingenting i något system. Skicka aldrig SMS ur Intelliplan (välj alltid Close).
- Spara filerna exakt som systemet exporterar dem. Öppna och spara inte om dem i Excel, byt inte namn på kolumner och ta inte bort rader. Det är just det råa formatet appen ska byggas mot.
- Period: september 2026 om inget annat står.
- Filnamn: <källa>_<rapport>_<bolag>_<period>.<ext>, t.ex. intelliplan_timmar_MBAB_2026-09.xlsx
- Kan systemet spara rapporten som mall: spara den under Karims egna mallar som "MB Stats – <rapport>", så blir nästa månad ett klick.

Filer

1. Intelliplan – timmar: alla attesterade/exporterade pass i september, med kund, uppdrag (nummer och namn), konsultens anställnings-id, datum, timmar, status och ev. frånvaroorsak. Ta med antal pass per rad om det finns. Finns ett fakturaunderlag per kund: ta med det också.
2. Intelliplan – frånvaro: sjukfrånvaro (SJUK LO, SJUK UNI) och olovlig frånvaro i september, per kund och konsult, i timmar eller dagar.
3. Intelliplan – konsultlista: alla konsulter, även tidigare anställda: anställnings-id, namn, anställningsform, kollektivavtal, organisationsenhet, anställningens start- och slutdatum, status.
4. Intelliplan – kundlista: kundnummer, kundnamn, arbetsställen.
5. Workbuster – deltagare: en export per bolag (Miljonbemanning AB och Miljonbemanning Restart AB) med alla deltagare som varit aktiva någon gång sedan 2025-01-01: tjänst (ROM2, KROM, KVL, Karriärvägledning, Stöd och matchning), ort/leveransområde, GEN- eller referensnummer, startdatum, slutdatum, avbrott och avbrottsorsak, status och resultat (arbete/studier, signal, R1/R2). Går det att välja bort kolumner: ta bort namn och personnummer. Annars exportera som den är.
6. Fortnox – SIE4: en fil per bolag (Miljonbemanning AB och Miljonbemanning Restart AB), SIE typ 4 med verifikationer, för räkenskapsåret 2025 och 2026 hittills. Spara som .se och lägg en kopia med ändelsen .txt bredvid.
7. Fortnox – resultatrapport som PDF per bolag: januari–september 2026 och helår 2025. Används för att stämma av appens siffror mot Fortnox.
8. Budget 2026: den Excel-fil som används i dag.
9. Dagens styrelseunderlag: senaste rapporten eller presentationen som visats för styrelsen och Excel-filen siffrorna kommer från (även Saras controlling-Excel om den fortfarande används).
10. Logotyper från SharePoint › Marknad & Kommunikation › Grafisk profil › Logotyp: Logo_WHITE-PRIMARY_MB-Miljonbemanning_2024 och Logo_DARK-PRIMARY_MB-Miljonbemanning_2024 i PNG och SVG, samt tertiär (MB.) i vit och mörk.
11. Fortnox – försäljning per kund: fakturerat belopp exkl. moms per kund och månad, 2025 och 2026 hittills, en fil per bolag (rapporten Försäljning per kund eller listan Kundfakturor, som Excel).
12. Intelliplan – fakturaunderlag och löneunderlag för september: per kund och konsult, med timmar, timpris eller fakturerat belopp, och timlön eller lönekostnad. Behövs för att räkna faktor per kund.
13. Workbuster – fakturor/ordrar: alla ordrar 2025 och 2026 hittills per bolag, med tjänst, ordertyp (grund-, period- och resultatersättning), belopp och datum. Visar vad AF genererat per program.

Till sist: skriv LÄSMIG.md i mappen med en rad per fil: filnamn, system, exakt menyväg och filter du använde, period, bolag, och vad du inte fick fram och varför. Menyvägarna blir månadsrutinen, så de ska gå att följa nästa månad. Inga personnamn eller personnummer i LÄSMIG.md.
