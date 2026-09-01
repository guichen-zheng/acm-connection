import type { Language, Site } from "@algo-sync/shared";
import { normalizeLanguage } from "./adapters";

export function languageSwitchHasSettled(
  site: Site,
  wanted: Language,
  controlLabel: string | undefined,
  editorLanguage: string | undefined
): boolean {
  const controlLanguage = normalizeLanguage(controlLabel);
  const modelLanguage = normalizeLanguage(editorLanguage);

  // Nowcoder changes the selected compiler immediately, but it can leave the
  // old Monaco model mounted until a background tab becomes visible. The
  // selected Element UI value is the site's source of truth in that state.
  if (site === "nowcoder" && controlLanguage !== undefined) {
    return controlLanguage === wanted && hasPreferredNowcoderVariant(wanted, [controlLabel, editorLanguage]);
  }

  if (controlLanguage !== undefined && controlLanguage !== wanted) return false;
  if (modelLanguage !== undefined && modelLanguage !== wanted) return false;
  return (controlLanguage === wanted || modelLanguage === wanted) &&
    hasPreferredNowcoderVariant(wanted, [controlLabel, editorLanguage]);
}

function hasPreferredNowcoderVariant(wanted: Language, labels: Array<string | undefined>): boolean {
  if (wanted !== "python") return true;
  const normalized = labels
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/（/g, "(").replace(/\s+/g, " ").trim());
  if (normalized.some((value) => /^(?:python|pypy)\s*2(?:\b|\s|\()/i.test(value))) return false;
  return normalized.some((value) => /^(?:python|pypy)\s*3(?:\b|\s|\()/i.test(value));
}
