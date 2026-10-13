# Prompt till Claude Cowork – månadsexport från Intelliplan

Spara allt under strecket som en mall i Claude Cowork och kör den varje månad. Vill du köra en annan
månad än den förra: skriv månaden (ÅÅÅÅ-MM) på en egen rad efter prompten.

---

Uppdrag: Månadsexport från Intelliplan till MB Stats.

MB Stats är vår statistik- och styrelseapp. Ur Intelliplans exporter räknar den timmar, pass och
konsulter i arbete per kund och uppdrag, sjuktimmar och sjukpass, fakturerat, lönekostnad och faktor
per kund, och anställda, nyanställda, avslutade anställningar och genomsnittlig anställningstid. Appen
känner igen filerna på kolumnrubrikerna, så varje export måste ha samma kolumner i samma ordning varje
månad.

Månad: föregående kalendermånad (kör du den 4 november gäller oktober), om jag inte skriver en annan
månad efter prompten. Den kallas ÅÅÅÅ-MM nedan. Månadens pass ska vara attesterade och lönen för månaden
körd, annars blir timmar och lön ofullständiga. Ser det inte klart ut: exportera ändå och skriv det
överst i loggen.

Regler

- Bara läsa och exportera. Ändra, attestera, boka, skicka eller radera ingenting. Skicka aldrig SMS
  eller e-post ur Intelliplan: välj alltid Close eller Avbryt om en sådan dialog öppnas.
- Konsultens anställnings-id ska finnas på varje rad i fil 1–4: appen räknar unika konsulter på det.
  Konsultnamn får följa med. Välj bort personnummer, adress, telefon och e-post när det går. Går det
  inte: exportera ändå, appen tar bort personnummer innan något sparas. Skriv aldrig personnummer i
  chatten eller i loggen.
- Filtrera inte bort något för hand. Ta med allt, även testkunden "Miljonbemanning Presentation
  (Stockholm)" och pass med "Okänd arbetstagare"; appen hanterar dem.
- Spara filerna exakt som Intelliplan exporterar dem, helst .xlsx (annars .csv). Öppna och spara inte
  om dem i Excel, byt inte namn på kolumner och ta inte bort rader eller kolumner.
- Mallar: första gången sparar du varje rapport som mall i Intelliplan med namnet "MB Stats – <rapport>"
  (t.ex. "MB Stats – timmar"). Följande månader använder du mallarna och ändrar bara datumen. Ändra
  aldrig kolumnerna i en sparad mall, då känner appen inte igen filen. Går det inte att spara mallar:
  skriv i loggen exakt vilka kolumner och filter du valde, i ordning.
- En fil per bolag som har konsulter i Intelliplan, troligen bara Miljonbemanning AB (MBAB). Finns även
  Miljonbemanning Restart AB (MBR) i Intelliplan: gör samma filer för MBR.
- Spara i OneDrive: `Dokument/MB Stats/månadsexport/ÅÅÅÅ-MM/` (skapa mappen). Lägg ingenting i
  Obsidian-valvet.
- Filnamn: `intelliplan_<rapport>_<MBAB|MBR>_ÅÅÅÅ-MM.<ext>`, t.ex.
  `intelliplan_timmar_MBAB_2026-10.xlsx`. Appen läser bolag och månad ur filnamnet.

Filer

1. Timmar och pass: `intelliplan_timmar_<bolag>_ÅÅÅÅ-MM`

   Urval: alla arbetade pass med datum i månaden som är attesterade eller exporterade till lön eller
   faktura. Inte frånvaro (den kommer i fil 2) och inte avbokade pass.

   En rad per pass, så räknar appen passen. Kolumner:
   - Datum
   - Kund (namn och kundnummer) och arbetsställe om det finns
   - Uppdrag (nummer och namn)
   - Konsultens anställnings-id (och namn)
   - Timmar (arbetade eller fakturerbara)
   - Status
   - Organisationsenhet eller avdelning om det finns

   Kan rapporten bara visa summerade rader: ta med en kolumn med antal pass och skriv det i loggen.

2. Frånvaro: `intelliplan_franvaro_<bolag>_ÅÅÅÅ-MM`

   Urval: alla pass med datum i månaden som har frånvaro: sjukfrånvaro (SJUK LO, SJUK UNI med flera) och
   olovlig frånvaro. En rad per pass. Kolumner:
   - Datum
   - Kund (namn och kundnummer)
   - Uppdrag (nummer och namn)
   - Konsultens anställnings-id (och namn)
   - Frånvaroorsak eller frånvarotyp
   - Timmar (passets planerade timmar)

3. Fakturerat och lön: `intelliplan_fakturering_<bolag>_ÅÅÅÅ-MM`

   Urval: månadens fakturaunderlag och löneunderlag per kund, uppdrag och konsult. Kolumner:
   - Datum eller period
   - Kund (namn och kundnummer)
   - Uppdrag (nummer och namn)
   - Konsultens anställnings-id (och namn)
   - Timmar
   - Fakturerat belopp exklusive moms (helst belopp; finns bara timpris, ta med det)
   - Lönekostnad: bruttolön, och lön inklusive sociala avgifter och semesterersättning som egen kolumn
     om den finns

   Viktigt: fakturerat och lön ska ligga i samma fil, eftersom appen ersätter en månads underlag med
   den senaste filen. Finns ingen rapport med båda: exportera fakturaunderlaget och löneunderlaget var
   för sig som `intelliplan_fakturaunderlag_<bolag>_ÅÅÅÅ-MM` och `intelliplan_loneunderlag_<bolag>_ÅÅÅÅ-MM`
   och skriv det överst i loggen.

4. Konsultlista med anställningshistorik: `intelliplan_konsulter_<bolag>_ÅÅÅÅ-MM`

   Urval: alla anställningar, även avslutade och tidigare anställda, så långt bakåt som Intelliplan
   visar. Appen räknar anställda, nyanställda och avslutade för varje månad ur hela historiken.

   En rad per anställning. Kolumner:
   - Anställnings-id
   - Anställningens startdatum
   - Anställningens slutdatum (tomt om pågående)
   - Anställningsform
   - Kollektivavtal
   - Ort eller organisationsenhet
   - Status
   - Namn får följa med

Kontroll innan du är klar

- Varje fil går att öppna, har en rubrikrad och minst en datarad, och datumen täcker rätt period.
- Varje rad i fil 1–4 har ett anställnings-id.
- Jämför antalet rader med förra månadens fil (`Dokument/MB Stats/månadsexport/<förra månaden>/`) om den
  finns. Skiljer det mer än 25 %: skriv det i loggen.

Logg

Skriv `LÄSMIG-intelliplan.md` i månadsmappen med en rad per fil: filnamn, exakt menyväg, filter och
vald mall, period, bolag, antal rader, och vad som inte gick att få fram och varför. Första gången
beskriver du menyvägen så noga att den går att följa nästa månad. Inga namn eller personnummer i
loggen.

Svara mig till sist kort: vilka filer som finns, antal rader per fil och eventuella problem.
