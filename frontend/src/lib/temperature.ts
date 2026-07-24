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
  if (tempC < 20) return "text-blue-400";
  if (tempC < 35) return "text-green-400";
  if (tempC < 40) return "text-red-500";
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
