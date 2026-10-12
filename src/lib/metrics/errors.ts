// Errors raised by the metric engine. Messages are Swedish because they can reach
// the settings UI (formula editor) and the report builder.

/** A metric definition that cannot be evaluated (unknown key, bad formula, missing config). */
export class MetricConfigError extends Error {
  readonly metricKey: string | null;

  constructor(message: string, metricKey: string | null = null) {
    super(message);
    this.name = "MetricConfigError";
    this.metricKey = metricKey;
  }
}

/** A formula that does not parse. `position` is the 0-based character offset. */
export class FormulaSyntaxError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = "FormulaSyntaxError";
    this.position = position;
  }
}

/**
 * Board output (slides, frozen reports, share links) referenced a personal dimension.
 * Thrown before anything is queried so personal data never reaches a ResolvedSlide.
 */
export class PersonalDataError extends Error {
  readonly dimensions: string[];

  constructor(dimensions: string[], context: string) {
    super(
      `${context} får inte grupperas eller filtreras på personuppgifter (${dimensions.join(", ")}).`,
    );
    this.name = "PersonalDataError";
    this.dimensions = dimensions;
  }
}
