import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Landing from "./pages/Landing";
import Home from "./pages/Home";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Intro from "./pages/Intro";
import ResetPassword from "./pages/ResetPassword";
import Meetings from "./pages/Meetings";
import MeetingDetail from "./pages/MeetingDetail";
import NotFound from "./pages/NotFound";
import ImportTasks from "./pages/ImportTasks";
import GoogleConnected from "./pages/GoogleConnected";
import SharedAction from "./pages/SharedAction";
import Preview from "./pages/Preview";
import PreviewApp from "./pages/PreviewApp";
// DEV-ONLY reproduction harnesses (routes gated by import.meta.env.DEV below).
import DrawerRepro from "./pages/DrawerRepro";
import BrainDumpRepro from "./pages/BrainDumpRepro";
import MotionTweaks from "./components/dev/MotionTweaks";
import { IS_SHELL } from "./lib/shell";


const queryClient = new QueryClient();

// ?tweaks anywhere in the query string mounts the motion-tuning panel
// (works on the deployed Pages build too — that is the point: Igor tunes
// on his phone). Evaluated once at module load; no effects, no state.
const showMotionTweaks =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("tweaks");

// Supabase persists its session in localStorage under this fixed key (see
// integrations/supabase/client.ts: storage: localStorage, persistSession).
// Reading it is synchronous, so the shell's "/" redirect target is derivable
// during render. If the stored token turns out stale, Home's own auth guard
// falls back to /auth — same as an expired session anywhere else in the app.
const hasStoredSession = () => {
  try {
    return localStorage.getItem('sb-mshlbsgsyzzfxyxramjj-auth-token') !== null;
  } catch {
    return false;
  }
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      
      <Toaster />
      <Sonner />
      {showMotionTweaks && <MotionTweaks />}
      <Routes>
        {/* The iOS shell is the app, not the marketing site: "/" (cold start,
            any legacy link back to root) goes straight to auth, or to /home
            when a stored session exists (read synchronously so the login card
            never paints for a signed-in launch). The branch is chosen during
            render and Landing never mounts in the shell; the URL flip itself
            is react-router's own effect. */}
        <Route path="/" element={IS_SHELL ? <Navigate to={hasStoredSession() ? "/home" : "/auth"} replace /> : <Landing />} />
        <Route path="/home" element={<Home />} />
        <Route path="/app" element={<Index />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/intro" element={<Intro />} />
        <Route path="/meetings" element={<Meetings />} />
        <Route path="/meetings/:id" element={<MeetingDetail />} />
        <Route path="/import-tasks" element={<ImportTasks />} />
        <Route path="/google-connected" element={<GoogleConnected />} />
        <Route path="/respond" element={<SharedAction />} />
        <Route path="/preview" element={<Preview />} />
        <Route path="/preview/app" element={<PreviewApp />} />
        {/* DEV-ONLY: mobile Projects drawer reproduction harness (see
            DrawerRepro.tsx + tests/drawer.spec.ts). Distinct keys force a
            remount when navigating between the two, mirroring the real app's
            /meetings -> /app route change. Not reachable in production. */}
        {import.meta.env.DEV && (
          <>
            <Route path="/dev/drawer-repro" element={<DrawerRepro key="repro" />} />
            <Route path="/dev/drawer-away" element={<DrawerRepro key="away" />} />
            {/* DEV-ONLY: Brain Dump save-path harness (see BrainDumpRepro.tsx +
                tests/braindump-save.spec.ts). Mirrors Home's brain-dump wiring
                with pre-loaded tasks, so Save All Tasks runs with no mic. */}
            <Route path="/dev/braindump-repro" element={<BrainDumpRepro />} />
          </>
        )}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;