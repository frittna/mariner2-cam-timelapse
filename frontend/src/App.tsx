import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppNav } from "@/components/AppNav";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Files from "./pages/Files";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Timelapse from "./pages/Timelapse";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <div className="dark min-h-screen bg-background text-foreground">
          <AppNav />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/files" element={<Files />} />
            <Route path="/timelapse" element={<Timelapse />} />
            <Route path="/settings" element={<Timelapse />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
