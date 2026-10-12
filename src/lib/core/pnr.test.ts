import { describe, expect, it } from "vitest";
import {
  PNR_PLACEHOLDER,
  columnContainsPersonnummer,
  containsPersonnummer,
  detectPersonalColumn,
  isOrgNr,
  isPersonnummer,
  luhnValid,
  redactPersonnummer,
  valueContainsPersonnummer,
} from "./pnr";

/** Append the Luhn check digit to nine digits. */
function withCheck(nine: string): string {
  for (let d = 0; d <= 9; d++) if (luhnValid(nine + d)) return nine + d;
  throw new Error("unreachable");
}

// Skatteverket's well-known test number and a samordningsnummer (day + 60).
const PNR = "121212-1212";
const SAMORDNING = "701063-2391";

describe("luhnValid", () => {
  it("validates known numbers", () => {
    expect(luhnValid("1212121212")).toBe(true);
    expect(luhnValid("1212121213")).toBe(false);
    expect(luhnValid("5569599318")).toBe(true);
    expect(luhnValid("12a")).toBe(false);
  });
});

describe("isPersonnummer", () => {
  it.each([
    PNR,
    "1212121212",
    "19121212-1212",
    "191212121212",
    "121212+1212",
    SAMORDNING,
    "7010632391",
    "19701063-2391",
    ` ${PNR} `,
  ])("%j is a personnummer", (s) => {
    expect(isPersonnummer(s)).toBe(true);
  });

  it("accepts generated valid numbers incl. leap days", () => {
    const leap = withCheck("000229123"); // 2000-02-29
    expect(isPersonnummer(leap)).toBe(true);
    expect(isPersonnummer(`20${leap}`)).toBe(true);
    // 1900 was not a leap year, 2000 was.
    expect(isPersonnummer(`19${leap}`)).toBe(false);
  });

  it.each([
    "121212-1213", // Luhn
    "121312-1212", // month 13
    "120231-1234", // 31 Feb
    "1212121", // too short
    "12121212121", // 11 digits
    "991231-12345",
    "21121212-1212", // century 21
    "556959-9318", // org number
    "5592089071", // org number
    "abc",
    "",
  ])("%j is not a personnummer", (s) => {
    expect(isPersonnummer(s)).toBe(false);
  });

  it("rejects samordningsnummer with impossible day", () => {
    expect(isPersonnummer(withCheck("701092123"))).toBe(false); // day 92 - 60 = 32
  });
});

describe("isOrgNr", () => {
  it.each(["556959-9318", "5569599318", "559208-9071", "5592089071", "16556959-9318"])(
    "%j is an org number",
    (s) => {
      expect(isOrgNr(s)).toBe(true);
    },
  );

  it.each(["556959-9319", PNR, "1212121212", "55695993", "abc"])("%j is not", (s) => {
    expect(isOrgNr(s)).toBe(false);
  });
});

describe("containsPersonnummer", () => {
  it("finds personnummer inside text", () => {
    expect(containsPersonnummer(`Anna ${PNR} Malmö`)).toBe(true);
    expect(containsPersonnummer("pnr:191212121212;")).toBe(true);
    expect(containsPersonnummer(SAMORDNING)).toBe(true);
  });

  it("ignores org numbers, dates, amounts and longer digit runs", () => {
    expect(containsPersonnummer("Miljonbemanning AB 556959-9318")).toBe(false);
    expect(containsPersonnummer("2026-09-30")).toBe(false);
    expect(containsPersonnummer("1 212 121 212")).toBe(false);
    expect(containsPersonnummer("01212121212123")).toBe(false);
    expect(containsPersonnummer("")).toBe(false);
  });

  it("checks numeric cell values as digit strings", () => {
    expect(valueContainsPersonnummer(1212121212)).toBe(true);
    expect(valueContainsPersonnummer(191212121212)).toBe(true);
    expect(valueContainsPersonnummer(8.5)).toBe(false);
    expect(valueContainsPersonnummer(null)).toBe(false);
    expect(valueContainsPersonnummer(true)).toBe(false);
  });
});

describe("detectPersonalColumn", () => {
  it("detects personnummer by header", () => {
    expect(detectPersonalColumn("Personnummer", []).kind).toBe("pnr");
    expect(detectPersonalColumn("PNR", ["x"]).kind).toBe("pnr");
    expect(detectPersonalColumn("SSN", []).kind).toBe("pnr");
  });

  it("detects personnummer by values (>= 30 %) even under an id header", () => {
    const samples = [PNR, SAMORDNING, "", "123", "456", "789"];
    const d = detectPersonalColumn("Anställnings id", samples);
    expect(d.kind).toBe("pnr");
    expect(d.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("does not flag below the 30 % threshold", () => {
    const samples = [PNR, "1", "2", "3", "4"];
    expect(detectPersonalColumn("Kommentar", samples).kind).toBeNull();
  });

  it("does not flag org numbers", () => {
    expect(detectPersonalColumn("Org.nr", ["556959-9318", "559208-9071"]).kind).toBeNull();
  });

  it("does not flag anställnings-id or GEN numbers", () => {
    expect(detectPersonalColumn("Anställnings id", ["1001", "1002", "1003"]).kind).toBeNull();
    expect(detectPersonalColumn("GEN", ["GEN123456", "GEN654321"]).kind).toBeNull();
    expect(detectPersonalColumn("GEN-nummer", ["123456", "654321"]).kind).toBeNull();
    expect(detectPersonalColumn("Referensnummer", ["0701234567"]).kind).toBeNull();
  });

  it.each([
    ["Namn", "name"],
    ["Förnamn", "name"],
    ["Efternamn", "name"],
    ["Konsult namn", "name"],
    ["Name", "name"],
    ["Last name", "name"],
    ["Handläggare", "name"],
    ["E-post", "email"],
    ["Epost", "email"],
    ["Mail", "email"],
    ["E-mail", "email"],
    ["Telefon", "phone"],
    ["Mobil", "phone"],
    ["Tel", "phone"],
    ["Tel.nr", "phone"],
    ["Mobilnummer", "phone"],
    ["Adress", "address"],
    ["Gatuadress", "address"],
    ["Postadress", "address"],
    ["Postnummer", "address"],
    ["C/O", "address"],
    ["Födelsedatum", "birthdate"],
  ])("header %j -> %s", (header, kind) => {
    expect(detectPersonalColumn(header, []).kind).toBe(kind);
  });

  it.each(["Kundnamn", "Kund namn", "Uppdragsnamn", "Företagsnamn", "Kundadress", "Ort", "Kund"])(
    "organisation header %j is not personal",
    (header) => {
      expect(detectPersonalColumn(header, ["Acme AB", "Beta Bygg"]).kind).toBeNull();
    },
  );

  it("detects e-mail and phone columns by values", () => {
    expect(detectPersonalColumn("Kontakt", ["anna@example.se", "bo@example.com", ""]).kind).toBe(
      "email",
    );
    expect(
      detectPersonalColumn("Kontakt", ["070-123 45 67", "+46 70 123 45 67", "08-123 456 78"]).kind,
    ).toBe("phone");
  });

  it("does not take zero-padded ids for phone numbers", () => {
    expect(detectPersonalColumn("Kod", ["00012345", "00012346"]).kind).toBeNull();
  });

  it("detects addresses by values", () => {
    expect(
      detectPersonalColumn("Bostad", ["Storgatan 12", "Lillvägen 3B", "211 45 Malmö"]).kind,
    ).toBe("address");
  });

  it("detects names under person-ish headers by values", () => {
    expect(
      detectPersonalColumn("Konsult", ["Anna Svensson", "Svensson, Bo", "Karin Öberg"]).kind,
    ).toBe("name");
    expect(detectPersonalColumn("Konsult", ["1001", "1002"]).kind).toBeNull();
  });

  it("returns null for ordinary business columns", () => {
    expect(detectPersonalColumn("Timmar", ["8,5", "7"]).kind).toBeNull();
    expect(detectPersonalColumn("Verksamhet", ["KROM", "ROM2"]).kind).toBeNull();
    expect(detectPersonalColumn("Datum", ["2026-09-30"]).kind).toBeNull();
  });
});

// Born 2000–2009: Excel turns "0501019806" typed into a number cell into 501019806.
const ZERO_LOST = [501019806, 712249804, 307159806];

describe("personnummer that lost their leading zero in Excel", () => {
  it("detects a column of 9-digit numbers that are personnummer once zero-padded", () => {
    const d = detectPersonalColumn("Kolumn F", ZERO_LOST.map(String));
    expect(d.kind).toBe("pnr");
  });

  it("flags such a column for the aggregation guard, numbers or digit strings", () => {
    expect(columnContainsPersonnummer(ZERO_LOST)).toBe(true);
    expect(columnContainsPersonnummer(ZERO_LOST.map(String))).toBe(true);
    expect(columnContainsPersonnummer([null, "", 8.5, ...ZERO_LOST])).toBe(true);
  });

  it("does not flag 9-digit id columns where only a stray value pads to a valid number", () => {
    const ids = Array.from({ length: 30 }, (_, i) => 100000000 + i * 7919);
    expect(columnContainsPersonnummer([...ids, ZERO_LOST[0]])).toBe(false);
    expect(
      detectPersonalColumn("Ordernummer", [...ids, ZERO_LOST[0]!].map(String)).kind,
    ).toBeNull();
  });

  it("keeps the single-value check for 10- and 12-digit forms", () => {
    expect(columnContainsPersonnummer(["1", "2", "3", "4", PNR])).toBe(true);
    expect(columnContainsPersonnummer(["1001", "1002", 46295])).toBe(false);
    expect(columnContainsPersonnummer([])).toBe(false);
  });
});

describe("redactPersonnummer", () => {
  it("masks every personnummer and samordningsnummer in a text", () => {
    expect(redactPersonnummer(`"${PNR}" är inte ett tal`)).toBe(
      `"${PNR_PLACEHOLDER}" är inte ett tal`,
    );
    expect(redactPersonnummer(`a ${SAMORDNING}, b 191212121212`)).toBe(
      `a ${PNR_PLACEHOLDER}, b ${PNR_PLACEHOLDER}`,
    );
  });

  it("leaves org numbers, dates, amounts and other digits alone", () => {
    const text = "Org.nr 556959-9318, 2026-09-30, 1 234 567,50 kr, 12345678901";
    expect(redactPersonnummer(text)).toBe(text);
  });
});
