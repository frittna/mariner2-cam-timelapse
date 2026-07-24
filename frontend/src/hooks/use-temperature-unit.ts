import * as React from "react";

import {
  getStoredTemperatureUnit,
  setStoredTemperatureUnit,
  subscribeTemperatureUnit,
  type TemperatureUnit,
} from "@/lib/temperature";

export function useTemperatureUnit() {
  const [unit, setUnitState] = React.useState<TemperatureUnit>(
    getStoredTemperatureUnit,
  );

  React.useEffect(() => {
    return subscribeTemperatureUnit(() => {
      setUnitState(getStoredTemperatureUnit());
    });
  }, []);

  const setUnit = React.useCallback((nextUnit: TemperatureUnit) => {
    setStoredTemperatureUnit(nextUnit);
    setUnitState(nextUnit);
  }, []);

  return { unit, setUnit };
}
