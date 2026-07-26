export type TemperatureUnit = "C" | "F";

const STORAGE_KEY = "mariner_temperature_unit";
const CHANGE_EVENT = "mariner-temperature-unit-change";

export function getStoredTemperatureUnit(): TemperatureUnit {
  if (typeof window === "undefined") {
    return "C";
  }

  return localStorage.getItem(STORAGE_KEY) === "F" ? "F" : "C";
}

export function setStoredTemperatureUnit(unit: TemperatureUnit): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(STORAGE_KEY, unit);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeTemperatureUnit(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      callback();
    }
  };
  const handleChange = () => callback();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, handleChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, handleChange);
  };
}

export function getTemperatureColorClass(
  tempC: number | null | undefined,
): string {
  if (tempC == null) return "text-muted-foreground";
  let coolMax = 20;
  let normalMax = 35;
  let hotMax = 40;
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem("mariner_temp_thresholds_c");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === "object") {
          if (Number.isFinite(parsed.coolMax)) coolMax = parsed.coolMax;
          if (Number.isFinite(parsed.normalMax)) normalMax = parsed.normalMax;
          if (Number.isFinite(parsed.hotMax)) hotMax = parsed.hotMax;
        }
      }
    } catch (e) {
      console.error("error loading user defined temperature bands:", e);
    }
  }
  if (tempC < coolMax) return "text-blue-400";
  if (tempC < normalMax) return "text-green-400";
  if (tempC < hotMax) return "text-red-500";
  return "text-pink-400";
}

export function formatTemperature(
  tempC: number | null | undefined,
  unit: TemperatureUnit,
): string {
  if (tempC == null) {
    return `-- °${unit}`;
  }

  const value = unit === "F" ? tempC * 9 / 5 + 32 : tempC;
  return `${value.toFixed(1)} °${unit}`;
}
