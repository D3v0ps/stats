# Prompt till Claude Cowork – månadsexport från Workbuster

Spara allt under strecket som en mall i Claude Cowork och kör den varje månad. Vill du köra en annan
månad än den förra: skriv månaden (ÅÅÅÅ-MM) på en egen rad efter prompten.

---

Uppdrag: Månadsexport från Workbuster till MB Stats.

MB Stats är vår statistik- och styrelseapp. Ur Workbusters exporter räknar den aktiva, nya, avslutade
och avbrutna deltagare och resultat (arbete eller studier) per tjänst och ort, och AF-ersättningen per
tjänst och ordertyp. Appen känner igen filerna på kolumnrubrikerna, så varje export måste ha samma
kolumner i samma ordning varje månad.

Månad: föregående kalendermånad (kör du den 4 november gäller oktober), om jag inte skriver en annan
månad efter prompten. Den kallas ÅÅÅÅ-MM nedan.

Regler

- Bara läsa och exportera. Ändra, avsluta, attestera, skicka eller radera ingenting i Workbuster.
- Personuppgifter: välj bort namn, personnummer, e-post, telefon och adress i exporten när det går.
  GEN-nummer eller referensnummer ska vara kvar: appen använder det bara för att inte räkna samma
  deltagare två gånger och sparar det aldrig. Går kolumnerna inte att välja bort: exportera ändå, appen
  tar bort dem innan något sparas. Skriv aldrig deltagarnamn, personnummer eller GEN-nummer i chatten
  eller i loggen.
- Spara filerna exakt som Workbuster exporterar dem, helst .xlsx (annars .csv). Öppna och spara inte om
  dem i Excel, byt inte namn på kolumner och ta inte bort rader eller kolumner.
- Mallar: första gången sparar du varje export som rapportmall i Workbuster med namnet
  "MB Stats – <rapport>" (t.ex. "MB Stats – deltagare"). Följande månader använder du mallarna och
  ändrar bara datumen. Ändra aldrig kolumnerna i en sparad mall, då känner appen inte igen filen. Går
  det inte att spara mallar: skriv i loggen exakt vilka kolumner och filter du valde, i ordning.
- En fil per bolag: Miljonbemanning AB (MBAB) och Miljonbemanning Restart AB (MBR). Går det inte att dela
  upp per bolag: exportera en fil med en kolumn som visar bolaget, använd ALLA som bolagskod i filnamnet
  och gör likadant varje månad. Har ett bolag inga deltagare eller ordrar: skapa ingen fil för det och
  skriv det i loggen.
- Spara i OneDrive: `Dokument/MB Stats/månadsexport/ÅÅÅÅ-MM/` (skapa mappen). Lägg ingenting i
  Obsidian-valvet.
- Filnamn: `workbuster_<rapport>_<MBAB|MBR|ALLA>_ÅÅÅÅ-MM.<ext>`, t.ex.
  `workbuster_deltagare_MBAB_2026-10.xlsx`. Appen läser bolag och månad ur filnamnet.

Filer

1. Deltagare med historik: `workbuster_deltagare_<bolag>_ÅÅÅÅ-MM`

   Urval: alla deltagare som varit inskrivna någon gång från 2025-01-01 till och med sista dagen i
   månaden, även avslutade och avbrutna. Inte bara månadens deltagare: appen räknar om varje månad bakåt
   ur hela historiken, så rättelser i Workbuster slår igenom.

   En rad per deltagare och inskrivning, med kolumnerna:
   - GEN-nummer eller referensnummer
   - Tjänst eller program (ROM2, KROM, KVL, Karriärvägledning, Stöd och matchning …)
   - Ort, leveransområde eller kontor
   - Startdatum
   - Slutdatum (planerat eller faktiskt, tomt om pågående)
   - Avbrott (ja/nej eller avbrottsorsak) och avbrottsdatum
   - Status
   - Resultat eller utfall (arbete, studier, R1/R2, signal …) och resultatdatum om det finns

2. Ordrar och ersättning: `workbuster_ordrar_<bolag>_ÅÅÅÅ-MM`

   Urval: alla ordrar och fakturor mot Arbetsförmedlingen i månaden och de två månaderna före, så att
   sena ordrar och krediteringar kommer med. Första gången: från 2025-01-01 till och med månaden.

   En rad per order eller orderrad, med kolumnerna:
   - Datum som visar vilken månad ersättningen gäller (ordermånad eller leveransperiod; finns bara
     fakturadatum tar du det och skriver i loggen vilket datum du använde)
   - Tjänst eller program
   - Ordertyp eller ersättningstyp (grundersättning, periodersättning, resultatersättning …)
   - Ort eller leveransområde
   - Belopp exklusive moms (krediteringar med minustecken om Workbuster visar dem så)
   - Ordernummer eller fakturanummer

   Inga deltagarnamn eller personnummer i den här filen.

Kontroll innan du är klar

- Varje fil går att öppna, har en rubrikrad och minst en datarad, och datumen täcker rätt period.
- Rätt bolag i rätt fil.
- Jämför antalet rader med förra månadens fil (`Dokument/MB Stats/månadsexport/<förra månaden>/`) om den
  finns. Skiljer det mer än 25 %: skriv det i loggen.

Logg

Skriv `LÄSMIG-workbuster.md` i månadsmappen med en rad per fil: filnamn, exakt menyväg, filter och vald
mall, period, bolag, antal rader, och vad som inte gick att få fram och varför. Första gången beskriver
du menyvägen så noga att den går att följa nästa månad. Inga namn, personnummer eller GEN-nummer i
loggen.

Svara mig till sist kort: vilka filer som finns, antal rader per fil och eventuella problem.
