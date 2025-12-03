import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Book from "./pages/Book";
import NotFound from "./pages/NotFound";
import AdminLayout from "./components/admin/AdminLayout";
import AdminDashboard from "./pages/admin/Dashboard";
import BookingsList from "./pages/admin/BookingsList";
import BookingDetail from "./pages/admin/BookingDetail";
import Schedule from "./pages/admin/Schedule";
import Staff from "./pages/admin/Staff";
import Reminders from "./pages/admin/Reminders";
import Reports from "./pages/admin/Reports";
import Cleaning from "./pages/admin/Cleaning";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/book" element={<Book />} />
          
          {/* Admin Routes */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="bookings" element={<BookingsList />} />
            <Route path="bookings/:id" element={<BookingDetail />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="staff" element={<Staff />} />
            <Route path="reminders" element={<Reminders />} />
            <Route path="reports" element={<Reports />} />
            <Route path="cleaning" element={<Cleaning />} />
          </Route>
          
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
