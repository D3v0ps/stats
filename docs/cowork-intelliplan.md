# Prompt till Claude Cowork – månadsexport från Intelliplan

Spara allt under strecket som en mall i Claude Cowork och kör den varje månad. Vill du köra en annan
månad än den förra: skriv månaden (ÅÅÅÅ-MM) på en egen rad efter prompten. Vill du ta fram historik
första gången: skriv till exempel "historik 2025-01 till 2026-09" efter prompten.

Första gången du laddar upp filerna i MB Stats:

- **Konsultlistan:** kontrollera att **Exportdatum** är sista dagen i månaden (det läses ur
  filnamnet) och sätt **Första månad** till den månad du vill att statistiken ska börja.
- **Timmar, frånvaro och fakturering:** varje fil gäller en månad. Lägg till steget **Filtrera
  rader** som tar bort kunden "Miljonbemanning Presentation (Stockholm)", så kommer testkunden inte
  med i siffrorna.

---

Uppdrag: Månadsexport från Intelliplan till MB Stats.

MB Stats är vår statistik- och styrelseapp. Den känner igen filerna på kolumnrubrikerna, så varje
export ska ha samma kolumner varje månad.

Månad: föregående kalendermånad (kör du den 4 november gäller oktober), om jag inte skriver en annan
månad efter prompten. Den kallas ÅÅÅÅ-MM nedan. FÖRSTA är månadens första dag och SISTA dess sista dag
(t.ex. 2026-10-01 och 2026-10-31). Fil 1–3 gäller pass med passdatum från FÖRSTA till och med SISTA.

Börja här

1. Läs `LÄSMIG-intelliplan.md` i den senaste tidigare månadsmappen under `MB Stats\månadsexport\` (se
   Spara nedan). Finns den: följ samma menyvägar, mallar, kolumner och filter. Finns varken loggen
   eller mallar som heter "MB Stats – timmar", "MB Stats – franvaro", "MB Stats – fakturering" och
   "MB Stats – konsulter" i Intelliplan är det första körningen: skapa mallarna och skriv "Första
   körningen" överst i loggen. Stämmer en mall inte med loggen: ändra ingenting, skriv det i loggen och
   fråga mig.
2. Står det i den loggen att något inte var klart (oattesterade pass eller löneunderlag): gör först om
   fil 1–3 för den månaden, spara dem i dess mapp (ersätt filerna) och lägg till avsnittet "Omkörning
   <dagens datum>" i dess LÄSMIG.
3. Skriver jag "historik ÅÅÅÅ-MM till ÅÅÅÅ-MM" efter prompten: gör fil 1–3 för varje månad i
   intervallet, en fil per månad och bolag, i respektive månadsmapp. Fil 4 gör du bara för ÅÅÅÅ-MM,
   eftersom den innehåller hela historiken.
4. Är Intelliplan utloggat: be mig logga in själv och vänta. Logga aldrig in åt mig och hantera aldrig
   lösenord, engångskoder, BankID eller webbläsarens sparade lösenord.

Intelliplan visar ofta engelska namn (Staffing, Workdays = pass, Employment = anställning). Välj
kolumner efter innehåll, inte efter exakt ordalydelse.

Regler

- Bara läsa och exportera. Ändra, attestera, boka, skicka eller radera ingenting. Skicka aldrig SMS
  eller e-post: välj alltid Close eller Avbryt om en sådan dialog öppnas. Enda undantaget: du får skapa
  och använda egna rapportmallar (inte delade med andra) med exakt de fyra namnen ovan. Spara inte
  datumändringar i mallarna och ändra aldrig deras kolumner.
- Filtrera bara som det står under Urval. Rensa förvalda filter och exportera hela träfflistan, inte
  bara sidan som visas. Välj datumintervallet FÖRSTA–SISTA, inte veckor. Fil 1–3 får inte ha rader med
  datum utanför månaden: appen ersätter hela månadens siffror för varje månad som finns i filen. Dela
  aldrig upp en månad på flera filer, eftersom den senaste filen ersätter de tidigare.
- Bolag: kontrollera första gången om Intelliplan har ett val för bolag eller juridisk enhet och skriv
  svaret i loggen. Finns bara Miljonbemanning AB: gör bara filer för MBAB. Finns även Miljonbemanning
  Restart AB: gör samma filer för MBR. Går en rapport inte att dela per bolag: ta med en kolumn som
  visar bolaget, använd ALLA som bolagskod i filnamnet och gör likadant varje månad.
- Där det står "A (eller B)": ta A om den finns, annars B. Skriv exakta kolumnrubriker i loggen och
  välj likadant varje månad.
- Konsultens id: anställningsnumret eller personalnumret i Intelliplan, i en egen kolumn som bara
  innehåller id:t, och samma id i fil 1–4. Ta aldrig en kolumn där id och namn står ihop. Ser id:t ut
  som ett personnummer (10 eller 12 siffror som börjar med ett födelsedatum): använd det inte, leta
  efter ett annat id och skriv i loggen om inget finns, utan att skriva några värden. Appen stoppar
  annars hela filen. Namn får följa med i fil 1–3, men bara i en egen kolumn. Rader utan konsult
  ("Okänd arbetstagare", obemannade pass) får sakna id: ta med dem om de kommer med i urvalet, men
  vidga inte urvalet för deras skull och försök inte ta reda på vem det gäller.
- Filtrera inte bort testkunden "Miljonbemanning Presentation (Stockholm)"; det görs i appens
  importmall.
- Personuppgifter: välj bort personnummer, adress, bostadsort, telefon och e-post när det går. Går det
  inte: exportera ändå och ta inte bort kolumner själv. Appen sparar dem aldrig, men filen i OneDrive
  innehåller dem då: skriv "INNEHÅLLER PERSONUPPGIFTER – radera efter uppladdning" och vilka
  kolumnrubriker det gäller överst i loggen och i svaret.
- Skriv aldrig namn, personnummer, anställnings-id eller lön för en enskild person i chatten, i LÄSMIG
  eller i loggen i valvets inkorg. Beskriv problem med antal rader, aldrig med radernas innehåll.
  Kontrollera filerna med rubrikrad, antal rader, summor och tidigaste och senaste datum; visa aldrig
  rader eller celler.
- Spara i `C:\Users\karre\OneDrive - Miljonbemanning AB\Dokument\MB Stats\månadsexport\ÅÅÅÅ-MM\`
  (skapa mappen; utan dator: samma mapp `Dokument/MB Stats/månadsexport/ÅÅÅÅ-MM/` via Microsoft
  365-kopplingen). Aldrig i Obsidian-valvet (`Dokument\Obsidian\Karims hjärna`), i `System/Bilagor/`
  eller i `Claude outputs`: valvet synkas till GitHub. Går mappen inte att nå: spara ingenting någon
  annanstans, radera nedladdningen och säg till. Flytta (kopiera inte) varje fil från Hämtade filer så
  att ingen kopia ligger kvar. Inkorgsloggen i valvet skriver du som vanligt, men bara med månad,
  filnamn, antal rader och problem i allmänna ordalag.
- Ändra aldrig innehållet i en fil och spara aldrig om den i Excel eller något annat program. Att läsa
  den för kontrollen går bra; stäng utan att spara. Ta det format Intelliplan ger (helst .xlsx, annars
  .xls eller .csv) och samma format varje månad. Byt bara filnamn. Finns filen redan i mappen: ersätt
  den (inga kopior som "(1)") och skriv det i loggen.

Filer

1. Timmar och pass: `intelliplan_timmar_<bolag>_ÅÅÅÅ-MM.xlsx`

   Urval: arbetade pass med passdatum FÖRSTA–SISTA som är attesterade eller exporterade till lön eller
   faktura. Inte frånvaro (den kommer i fil 2) och inte avbokade pass.

   En rad per pass, så räknar appen passen. Kolumner:
   - Passdatum
   - Kund och kundnummer i egna kolumner, och arbetsställe om det finns
   - Uppdrag och uppdragsnummer
   - Konsultens id (och namn i en egen kolumn)
   - Fakturerbara timmar. Finns även arbetade timmar: ta med båda som egna kolumner.
   - Status
   - Organisationsenhet (eller avdelning)

   Visar rapporten bara summerade rader: ta med en kolumn med antal pass och skriv det överst i loggen.

2. Frånvaro: `intelliplan_franvaro_<bolag>_ÅÅÅÅ-MM.xlsx`

   Urval: pass med passdatum FÖRSTA–SISTA som har frånvaro: sjukfrånvaro (SJUK LO, SJUK UNI med flera)
   och olovlig frånvaro. En rad per pass. Kolumner:
   - Passdatum
   - Kund och kundnummer
   - Uppdrag och uppdragsnummer
   - Konsultens id
   - Frånvaroorsak (eller frånvarotyp)
   - Frånvarotimmar, alltså de timmar konsulten var borta. Finns bara passets planerade timmar: ta dem
     och skriv i loggen att delvis arbetade sjukpass då räknas dubbelt.

3. Fakturerat och lön: `intelliplan_fakturering_<bolag>_ÅÅÅÅ-MM.xlsx`

   Urval: fakturaunderlag och löneunderlag för pass med passdatum FÖRSTA–SISTA, samma pass som i fil 1.
   Inte fakturor med fakturadatum i månaden och inte lön som betalats ut i månaden. Löneunderlaget ska
   vara klart; lönen behöver inte vara utbetald.

   Kolumner:
   - Passdatum (eller period ÅÅÅÅ-MM), inte fakturadatum, förfallodatum eller utbetalningsdatum
   - Kund och kundnummer
   - Uppdrag och uppdragsnummer
   - Konsultens id
   - Timmar
   - Fakturerat belopp exklusive moms, som belopp per rad. Appen kan inte räkna timmar × timpris. Finns
     bara timpris: leta efter ett fakturaunderlag eller en fakturajournal med belopp. Finns inget: skriv
     "Fakturerat belopp saknas – bara timpris" överst i loggen.
   - Lönekostnad: bruttolön, och lön inklusive sociala avgifter och semesterersättning som egen kolumn
     om den finns

   Fakturerat och lön ska ligga i samma fil, eftersom appen ersätter en månads underlag med den senast
   uppladdade filen. Finns ingen rapport med båda: exportera dem var för sig som
   `intelliplan_fakturaunderlag_<bolag>_ÅÅÅÅ-MM.xlsx` och `intelliplan_loneunderlag_<bolag>_ÅÅÅÅ-MM.xlsx`
   och skriv överst i loggen och i svaret: "Fakturerat och lön är två filer. Ladda inte upp båda: den
   som laddas upp sist ersätter den andra."

4. Konsultlista med hela anställningshistoriken: `intelliplan_konsulter_<bolag>_ÅÅÅÅ-MM_export-SISTA.xlsx`,
   t.ex. `intelliplan_konsulter_MBAB_2026-10_export-2026-10-31.xlsx`. Datumet efter "export" är
   månadens sista dag: appen räknar fram till och med den dagen.

   Urval: alla anställningar oavsett datum, även avslutade och tidigare anställda. Inget filter på
   status eller startdatum (inte "Aktiva", inte "senaste 12 månaderna"). Kräver Intelliplan ett
   datumintervall: välj från tidigaste möjliga datum till i dag och "aktiva under perioden".

   En rad per anställningsperiod, inte per uppdrag eller placering. Kolumner:
   - Konsultens id
   - Anställningens startdatum
   - Anställningens slutdatum (tomt om pågående)
   - Anställningsform
   - Kollektivavtal
   - Organisationsenhet (eller kontor): det MB-kontor konsulten hör till, inte bostadsort
   - Status

   Inga namn i den här filen. Visar listan bara en rad per konsult: exportera ändå och skriv det
   överst i loggen.

Kontroll

- Fil 1–3: alla passdatum ligger inom FÖRSTA–SISTA, och antal rader är lika med antal träffar
  Intelliplan visar. Skriv båda talen i loggen.
- Varje rad utom obemannade pass har ett id, och inget id ser ut som ett personnummer. Skriv antalet
  rader utan id i loggen.
- Räkna pass i månaden som inte är attesterade och skriv antalet överst i loggen, liksom om
  löneunderlaget för månaden är klart och var du såg det. Är något inte klart: exportera ändå och
  avsluta svaret med "Kör om ÅÅÅÅ-MM när attesten och löneunderlaget är klara". Nästa månads körning
  gör det då automatiskt.
- Fil 4: antal rader och antal rader med slutdatum får inte vara lägre, och tidigaste startdatum inte
  senare, än i förra månadens LÄSMIG. Är de det: skriv det överst i loggen, eftersom appen räknar om
  alla månader ur den nya filen.
- Blir en fil tom (t.ex. ingen frånvaro): skapa ingen fil och skriv "0 rader" i loggen.

Logg

Skriv `LÄSMIG-intelliplan.md` i månadsmappen. Först en tabell med en rad per fil: filnamn, mall, urval
och filter, bolag, format, antal rader, antal träffar i Intelliplan, summa timmar, antal pass, summa
fakturerat och summa lön där det finns, och problem. Sedan avsnittet "Menyvägar" med steg för steg per
fil, så att nästa månad kan följa dem, och de kolumnrubriker du valde. Vid omkörning: lägg till
avsnittet "Omkörning <dagens datum>" i stället för att skriva över loggen.

Svara mig till sist kort: vilka filer som finns, antal rader och summor per fil, eventuella problem,
om någon fil innehåller personuppgifter och om månaden behöver köras om.
