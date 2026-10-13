# Prompt till Claude Cowork – månadsexport från Workbuster

Spara allt under strecket som en mall i Claude Cowork och kör den varje månad. Vill du köra en annan
månad än den förra: skriv månaden (ÅÅÅÅ-MM) på en egen rad efter prompten.

Första gången du laddar upp filerna i MB Stats:

- **Deltagare:** sätt **Första månad** till 2025-01 i importmallen och kontrollera att
  **Exportdatum** är sista dagen i månaden (det läses ur filnamnet).
- **Ordrar:** välj att **perioden kommer från datumkolumnen**, inte en månad per fil, eftersom filen
  innehåller alla månader från 2025-01.

---

Uppdrag: Månadsexport från Workbuster till MB Stats.

MB Stats är vår statistik- och styrelseapp. Den känner igen filerna på kolumnrubrikerna, så varje
export ska ha samma kolumner varje månad.

Månad: föregående kalendermånad (kör du den 4 november gäller oktober), om jag inte skriver en annan
månad efter prompten. Den kallas ÅÅÅÅ-MM nedan, och SISTA är månadens sista dag (t.ex. 2026-10-31).

Börja här

1. Läs `LÄSMIG-workbuster.md` i den senaste tidigare månadsmappen under `MB Stats\månadsexport\` (se
   Spara nedan). Finns den: följ samma menyvägar, mallar, kolumner och filter. Finns varken loggen
   eller mallar som heter "MB Stats – deltagare" och "MB Stats – ordrar" i Workbuster är det första
   körningen: skapa mallarna och skriv "Första körningen" överst i loggen. Stämmer en mall inte med
   loggen: ändra ingenting, skriv det i loggen och fråga mig.
2. Är Workbuster utloggat: be mig logga in själv och vänta. Logga aldrig in åt mig och hantera aldrig
   lösenord, BankID, engångskoder eller sparade inloggningar.

Regler

- Bara läsa och exportera. Ändra, avsluta, attestera, skicka eller radera ingenting. Enda undantaget:
  du får skapa och använda egna rapportmallar (inte delade med andra) med exakt namnen
  "MB Stats – deltagare" och "MB Stats – ordrar". Spara inte datumändringar i mallarna och ändra
  aldrig deras kolumner.
- Filtrera bara som det står under Urval. Rensa förvalda filter (handledare, coach, kontor, team,
  status, tjänst, "mina deltagare") och exportera hela träfflistan, inte bara sidan som visas. Värden
  inom parentes nedan är exempel, inte filter.
- En deltagarfil och en orderfil per bolag: Miljonbemanning AB (MBAB) och Miljonbemanning Restart AB
  (MBR). Alla tjänster och orter ska ligga i samma fil. Dela aldrig upp per tjänst, program eller ort:
  två filer för samma bolag och rapport ersätter varandra i appen. Har bolagen var sitt konto eller var
  sin organisation i Workbuster: byt och gör exporten för vart och ett. Går det inte att dela per bolag:
  gör en fil med en kolumn som visar bolaget, använd ALLA som bolagskod i filnamnet och gör likadant
  varje månad.
- Där det står "A (eller B)": ta A om den finns, annars B. Välj samma kolumner för båda bolagen och
  skriv exakta kolumnrubriker i loggen.
- Personuppgifter: välj bort namn, personnummer, e-post, telefon, adress, handläggare och fritext eller
  anteckningar när det går. GEN-nummer ska vara kvar i deltagarfilen: appen använder det bara för att
  inte räkna samma deltagare två gånger och sparar det aldrig. Går en personkolumn inte att välja bort:
  exportera ändå och ta inte bort kolumner själv. MB Stats sparar bara antal och belopp, men filen i
  OneDrive innehåller då personuppgifter: skriv "INNEHÅLLER PERSONUPPGIFTER – radera efter
  uppladdning" och vilka kolumnrubriker det gäller överst i loggen och i svaret.
- Skriv aldrig namn, personnummer, GEN-nummer, ordernummer, e-post, telefon eller adress i chatten, i
  LÄSMIG eller i loggen i valvets inkorg. Beskriv problem med antal ("3 rader saknar startdatum"),
  aldrig med enskilda rader. Kontrollera filerna med rubrikrad, antal rader och tidigaste och senaste
  datum; visa aldrig rader eller celler.
- Spara i `C:\Users\karre\OneDrive - Miljonbemanning AB\Dokument\MB Stats\månadsexport\ÅÅÅÅ-MM\`
  (skapa mappen; utan dator: samma mapp `Dokument/MB Stats/månadsexport/ÅÅÅÅ-MM/` via Microsoft
  365-kopplingen). Aldrig i Obsidian-valvet (`Dokument\Obsidian\Karims hjärna`), i `System/Bilagor/`
  eller i `Claude outputs`: valvet synkas till GitHub. Går mappen inte att nå: spara ingenting någon
  annanstans, radera nedladdningen och säg till. Flytta (kopiera inte) varje fil från Hämtade filer så
  att ingen kopia ligger kvar. Inkorgsloggen i valvet skriver du som vanligt, men bara med månad,
  filnamn, antal rader och problem i allmänna ordalag.
- Ändra aldrig innehållet i en fil och spara aldrig om den i Excel eller något annat program. Att läsa
  den för kontrollen går bra; stäng utan att spara. Ta det format Workbuster ger, helst .xlsx, och
  samma format varje månad. Byt bara filnamn. Finns filen redan i mappen: ersätt den (inga kopior som
  "(1)") och skriv det i loggen.

Filer

1. Deltagare med hela historiken: `workbuster_deltagare_<bolag>_ÅÅÅÅ-MM_export-SISTA.xlsx`, t.ex.
   `workbuster_deltagare_MBAB_2026-10_export-2026-10-31.xlsx`. Datumet efter "export" är månadens
   sista dag: appen räknar fram till och med den dagen.

   Urval: alla inskrivningar oavsett datum, även avslutade, avbrutna och de som startade före 2025, så
   långt bakåt som Workbuster visar. Sätt inget datumfilter. Ta inte med makulerade eller
   felregistrerade inskrivningar eller anvisade som aldrig skrevs in. Går de inte att välja bort:
   behåll Status-kolumnen och skriv i loggen vilka statusvärden som finns.

   En rad per deltagare och inskrivning. Kolumner:
   - GEN-nummer (eller referensnummer)
   - Tjänst (eller program): ROM2, KROM, KVL, Karriärvägledning, Stöd och matchning …
   - Ort (eller leveransområde eller kontor), samma fält som i orderfilen
   - Startdatum
   - Faktiskt slutdatum, tomt om deltagaren fortfarande är inskriven. Planerat slutdatum får bara finnas
     som en egen kolumn; byt aldrig det ena mot det andra.
   - Avbrott: en kolumn som bara är ifylld (eller "ja") för deltagare som avbrutit, och avbrottsdatum.
     Använd inte en avslutsorsak som är ifylld för alla som avslutats. Finns ingen egen
     avbrottskolumn: skriv det i loggen.
   - Resultat (eller utfall): arbete, studier, R1/R2, signal … och resultatdatum om det finns
   - Status
   - Bolag, om Workbuster har en sådan kolumn

2. Ordrar och ersättning: `workbuster_ordrar_<bolag>_ÅÅÅÅ-MM.xlsx`

   Urval: alla ersättningar från Arbetsförmedlingen från 2025-01-01 till och med SISTA, varje månad
   (inte bara den senaste månaden). Filtrera på samma datum som datumkolumnen nedan. Inget datum efter
   SISTA.

   En rad per fakturerad ersättning (fakturarad). Ta aldrig med både ordern och fakturan för samma
   ersättning. Kolumner:
   - Datum som visar vilken månad ersättningen gäller: ordermånad (eller leveransperiod, annars
     fakturadatum; skriv i loggen vilket). Ett datum eller en månad per rad, inte ett intervall.
   - Tjänst (eller program)
   - Ordertyp (eller ersättningstyp): grundersättning, periodersättning, resultatersättning …
   - Ort (eller leveransområde), samma fält som i deltagarfilen
   - Belopp exklusive moms, där krediteringar är negativa. Visar Workbuster krediteringar som positiva
     belopp: ta med kolumnen för fakturatyp och skriv det överst i loggen och i svaret (appen kan inte
     vända tecknet på enskilda rader).
   - Bolag, om Workbuster har en sådan kolumn

Kontroll

- Antal rader i varje fil är lika med antal träffar Workbuster visar för urvalet. Skriv båda talen i
  loggen.
- Deltagarfilen får aldrig ha färre rader än förra månadens deltagarfil (enligt förra månadens
  LÄSMIG), och ingen tjänst eller ort får ha försvunnit. Har den det: skriv det överst i loggen och i
  svaret, eftersom filen skriver över tidigare månader i appen.
- Orderfilen: datumen går från 2025-01 till ÅÅÅÅ-MM och inget ligger efter SISTA.
- Kontrollera bolagsvalet i Workbuster före varje export och skriv det i loggen.
- Skapa en fil bara om urvalet har rader. Har ett bolag inga rader alls: skriv det i loggen.

Logg

Skriv `LÄSMIG-workbuster.md` i månadsmappen. Först en tabell med en rad per fil: filnamn, mall, urval
och filter, bolag, format, antal rader, antal träffar i Workbuster, tidigaste och senaste datum, summa
belopp (orderfilen) och problem. Sedan avsnittet "Menyvägar" med steg för steg per fil, så att nästa
månad kan följa dem, och de kolumnrubriker du valde. Vid omkörning: lägg till avsnittet "Omkörning
<dagens datum>" i stället för att skriva över loggen.

Svara mig till sist kort: vilka filer som finns, antal rader och summa belopp per fil, eventuella
problem och om någon fil innehåller personuppgifter.
