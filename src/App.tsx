import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      
      <Toaster />
      <Sonner />
      <Routes>
        <Route path="/" element={<Landing />} />
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
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;