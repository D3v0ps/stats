// The settings sub-navigation: one route per section, each with one clear purpose.

export const SETTINGS_BASE = "/installningar";

export interface SettingsSection {
  slug: string;
  href: string;
  label: string;
  /** One sentence shown on the overview and under the section heading. */
  description: string;
}

const section = (slug: string, label: string, description: string): SettingsSection => ({
  slug,
  href: `${SETTINGS_BASE}/${slug}`,
  label,
  description,
});

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  section(
    "matt",
    "Mått",
    "Namn, enhet och decimaler för varje mått, och formler för beräknade mått.",
  ),
  section(
    "dimensioner",
    "Dimensioner och uppslag",
    "Verksamheter, kunder och andra grupperingar: byt namn, slå ihop och lägg till alias.",
  ),
  section(
    "kontogrupper",
    "Kontogrupper",
    "Vilka konton som räknas till intäkter, kostnader och resultat.",
  ),
  section("importmallar", "Importmallar", "Sparade mallar för filimporter, med versionshistorik."),
  section(
    "bolag",
    "Bolag och räkenskapsår",
    "Bolagens uppgifter och vilken månad räkenskapsåret börjar.",
  ),
  section("perioder", "Perioder", "Månader med data, och vilka månader som är stängda."),
  section("granskning", "Granskning", "När en uppladdning ska flaggas för granskning."),
  section("sakerhet", "Säkerhet", "Byt lösenord och logga ut alla enheter."),
];

/** The section a pathname belongs to (sub-pages included), or null for the overview. */
export function activeSection(pathname: string): SettingsSection | null {
  return (
    SETTINGS_SECTIONS.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`)) ?? null
  );
}

export function sectionBySlug(slug: string): SettingsSection {
  const found = SETTINGS_SECTIONS.find((s) => s.slug === slug);
  if (!found) throw new Error(`Unknown settings section: ${slug}`);
  return found;
}
