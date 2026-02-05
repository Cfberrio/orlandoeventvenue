import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { StaffSessionProvider } from "@/hooks/useStaffSession";
import Index from "./pages/Index";
import Book from "./pages/Book";
import BookingConfirmation from "./pages/BookingConfirmation";
import Auth from "./pages/Auth";
import Contact from "./pages/Contact";
import SmsTerms from "./pages/SmsTerms";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfUse from "./pages/TermsOfUse";
import NotFound from "./pages/NotFound";
import AdminLayout from "./components/admin/AdminLayout";
import ProtectedRoute from "./components/admin/ProtectedRoute";
import AdminDashboard from "./pages/admin/Dashboard";
import BookingsList from "./pages/admin/BookingsList";
import BookingDetail from "./pages/admin/BookingDetail";
import Schedule from "./pages/admin/Schedule";
import Staff from "./pages/admin/Staff";
import Reminders from "./pages/admin/Reminders";
import RevenueReports from "./pages/admin/RevenueReports";
import PayrollReports from "./pages/admin/PayrollReports";
import Cleaning from "./pages/admin/Cleaning";
import Inventory from "./pages/admin/Inventory";
import Discounts from "./pages/admin/Discounts";
// Staff Dashboard imports
import StaffLayout from "./components/staff/StaffLayout";
import StaffProtectedRoute from "./components/staff/StaffProtectedRoute";
import StaffLogin from "./pages/staff/StaffLogin";
import StaffBookingsList from "./pages/staff/StaffBookingsList";
import StaffBookingDetail from "./pages/staff/StaffBookingDetail";
import StaffSchedule from "./pages/staff/StaffSchedule";
import CleaningReportForm from "./pages/staff/CleaningReportForm";
import StaffInventory from "./pages/staff/StaffInventory";
// Guest Routes
import GuestReport from "./pages/guest/GuestReport";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <StaffSessionProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/book" element={<Book />} />
              <Route path="/booking-confirmation" element={<BookingConfirmation />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/sms-terms" element={<SmsTerms />} />
              <Route path="/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/terms-of-use" element={<TermsOfUse />} />
              
              {/* Admin Routes - Protected */}
              <Route path="/admin" element={
                <ProtectedRoute>
                  <AdminLayout />
                </ProtectedRoute>
              }>
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route path="bookings" element={<BookingsList />} />
                <Route path="bookings/:id" element={<BookingDetail />} />
                <Route path="schedule" element={<Schedule />} />
                <Route path="staff" element={<Staff />} />
                <Route path="reminders" element={<Reminders />} />
                <Route path="reports" element={<RevenueReports />} />
                <Route path="payroll" element={<PayrollReports />} />
                <Route path="cleaning" element={<Cleaning />} />
                <Route path="inventory" element={<Inventory />} />
                <Route path="discounts" element={<Discounts />} />
              </Route>

              {/* Staff Routes */}
              <Route path="/staff/login" element={<StaffLogin />} />
              <Route path="/staff" element={
                <StaffProtectedRoute>
                  <StaffLayout />
                </StaffProtectedRoute>
              }>
                <Route index element={<StaffBookingsList />} />
                <Route path="bookings/:id" element={<StaffBookingDetail />} />
                <Route path="bookings/:id/cleaning-report" element={<CleaningReportForm />} />
                <Route path="schedule" element={<StaffSchedule />} />
                <Route path="inventory" element={<StaffInventory />} />
              </Route>

              {/* Guest Routes - Public */}
              <Route path="/guest/report/:reservationNumber" element={<GuestReport />} />
              <Route path="/guest/report" element={<GuestReport />} />
              
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </StaffSessionProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
