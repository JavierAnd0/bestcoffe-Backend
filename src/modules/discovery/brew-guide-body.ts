/**
 * Una guía de preparación tiene estructura (resumen, tiempo, dificultad y
 * pasos), pero el modelo `BrewGuide` solo guarda `body: String`. Para no
 * migrar, el panel guarda esa estructura como JSON dentro de `body` y la API
 * pública la expande. Un `body` que no sea JSON (guías antiguas en texto) se
 * muestra como resumen, sin pasos.
 */

export const BREW_DIFFICULTIES = ['Fácil', 'Media', 'Avanzada'] as const;
export type BrewDifficulty = (typeof BREW_DIFFICULTIES)[number];

export interface BrewStep {
  title: string;
  body: string;
  durationSec: number;
  /** Agua acumulada al terminar el paso, en gramos ("vierte hasta 150 g"). */
  waterG: number | null;
}

/** Receta base de la guía: lo que el cliente necesita antes de empezar. */
export interface BrewRecipe {
  coffeeG: number | null;
  waterMl: number | null;
  tempC: number | null;
  grind: string;
}

export interface BrewGuideContent {
  summary: string;
  totalTime: string;
  difficulty: BrewDifficulty;
  recipe: BrewRecipe;
  steps: BrewStep[];
}

export const EMPTY_RECIPE: BrewRecipe = {
  coffeeG: null,
  waterMl: null,
  tempC: null,
  grind: '',
};

export function serializeBrewGuideBody(content: BrewGuideContent): string {
  return JSON.stringify({ v: 1, ...content });
}

export function parseBrewGuideBody(body: string | null): BrewGuideContent {
  const empty: BrewGuideContent = {
    summary: '',
    totalTime: '',
    difficulty: 'Media',
    recipe: { ...EMPTY_RECIPE },
    steps: [],
  };
  if (!body) return empty;
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ...empty, summary: body };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...empty, summary: body };
  }
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  const difficulty = BREW_DIFFICULTIES.includes(o.difficulty as BrewDifficulty)
    ? (o.difficulty as BrewDifficulty)
    : 'Media';
  const steps = Array.isArray(o.steps)
    ? o.steps
        .filter(
          (s): s is Record<string, unknown> => !!s && typeof s === 'object',
        )
        .map((s) => ({
          title: str(s.title),
          body: str(s.body),
          durationSec:
            typeof s.durationSec === 'number' && s.durationSec >= 0
              ? Math.round(s.durationSec)
              : 0,
          waterG: num(s.waterG),
        }))
    : [];
  const r =
    o.recipe && typeof o.recipe === 'object' && !Array.isArray(o.recipe)
      ? (o.recipe as Record<string, unknown>)
      : {};
  return {
    summary: str(o.summary),
    totalTime: str(o.totalTime),
    difficulty,
    recipe: {
      coffeeG: num(r.coffeeG),
      waterMl: num(r.waterMl),
      tempC: num(r.tempC),
      grind: str(r.grind),
    },
    steps,
  };
}
