import { Link, useLocation } from "react-router-dom";
import { Printer, FolderOpen, Film } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { PowerMenu } from "@/components/PowerMenu";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

const navItems = [
  { to: "/", label: "Dashboard", icon: Printer },
  { to: "/files", label: "Files", icon: FolderOpen },
  { to: "/timelapse", label: "Timelapse", icon: Film },
];

function getTempColor(temp: number | null | undefined): string {
  if (temp == null) return "text-muted-foreground";
  if (temp < 20) return "text-blue-400";
  if (temp < 24) return "text-yellow-400";
  if (temp < 31) return "text-green-400";
  return "text-red-500";
}

export function AppNav() {
  const location = useLocation();

  // DHT22 sensor polling every 60s
  const { data: sensorData } = useQuery({
    queryKey: ["dht22"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/sensors/dht22");
        return res.json();
      } catch (e) {
        return { ok: false };
      }
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const tempC = sensorData?.ok ? sensorData.temp_c : null;
  const humPct = sensorData?.ok ? sensorData.hum_pct : null;

  return (
    <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-sm">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary">
            <Printer className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight">
            Mariner 2 Cam
          </span>
        </div>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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
          
          {/* DHT22 Sensor Badge */}
          <div className="ml-2 flex items-center gap-2 border-l border-border pl-2 text-xs">
            <div className="flex flex-col items-end gap-0.5">
              <span className={cn("font-semibold", getTempColor(tempC))}>
                {tempC != null ? `${tempC.toFixed(1)}°C` : "—.-°C"}
              </span>
              <span className="text-muted-foreground">
                {humPct != null ? `${humPct.toFixed(0)}%` : "—%"}
              </span>
            </div>
          </div>

          <div className="ml-1 flex items-center gap-0.5 border-l border-border pl-1">
            <ThemeSwitcher />
            <PowerMenu />
          </div>
        </nav>
      </div>
    </header>
  );
}
