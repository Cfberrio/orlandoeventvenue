import { Navigate, useLocation } from "react-router-dom";
import { useStaffSession } from "@/hooks/useStaffSession";

interface StaffProtectedRouteProps {
  children: React.ReactNode;
}

export default function StaffProtectedRoute({ children }: StaffProtectedRouteProps) {
  const { staffMember, isLoading } = useStaffSession();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!staffMember) {
    // ST2-14: come back to the page the email linked to after signing in.
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/staff/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return <>{children}</>;
}
