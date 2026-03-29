import data from "../colours.json" assert { type: "json" };

export type Mode = "DAY" | "DUSK" | "NIGHT";
export type ColourName = keyof typeof data.DAY;
export type Colours = Record<Mode, Record<ColourName, string>>;

export const colours = data as Colours;

/** Look up a colour token for a given mode. */
export function colour(mode: Mode, name: ColourName): string {
  const value = colours[mode][name];
  if (!value) {
    throw new Error(`Unknown colour token: ${name}`);
  }
  return value;
}
