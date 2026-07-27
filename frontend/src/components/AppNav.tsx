import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Printer, Settings as SettingsIcon, WifiOff } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { PowerMenu } from "@/components/PowerMenu";
import { useTemperatureUnit } from "@/hooks/use-temperature-unit";
import { api } from "@/lib/api";
import {
  formatTemperature,
  getTemperatureColorClass,
} from "@/lib/temperature";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: Printer },
  { to: "/files", label: "Files", icon: FolderOpen },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function AppNav() {
  const location = useLocation();
  const { unit } = useTemperatureUnit();

  const { data: sensorData } = useQuery({
    queryKey: ["bmp280-nav"],
    queryFn: api.bmp280Temperature,
    refetchInterval: 30000,
    staleTime: 30000,
  });

  const { isError: isHostOffline } = useQuery({
    queryKey: ["hostStatus"],
    queryFn: api.timelapseStatus,
    refetchInterval: 5000,
    retry: 1,
  });

  const tempC = sensorData?.ok ? sensorData.temp_c : null;

  return (
    <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-sm">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-primary">
            <Printer className="h-4 w-4 text-primary-foreground" />
          </div>
          {isHostOffline && (
            <div
              className="flex h-6 w-6 items-center justify-center rounded border border-destructive/40 bg-destructive/10"
              title="Host offline"
              aria-label="Host offline"
            >
              <WifiOff className="h-4 w-4 text-destructive" />
            </div>
          )}
          <span className="font-display text-lg font-bold tracking-tight">
            Mariner 2 Cam
          </span>
        </div>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive =
              location.pathname === item.to ||
              (item.to === "/settings" && location.pathname === "/timelapse");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}

          <div className="ml-2 flex items-center gap-1 border-l border-border pl-2 text-xs">
            <span className={cn("font-semibold", getTemperatureColorClass(tempC))}>
              {formatTemperature(tempC, unit)}
            </span>
          </div>

          <div className="ml-1 flex items-center gap-0.5 border-l border-border pl-1">
            <PowerMenu />
          </div>
        </nav>
      </div>
    </header>
  );
}

