import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

interface StaffProtectedRouteProps {
  children: React.ReactNode;
}

export default function StaffProtectedRoute({ children }: StaffProtectedRouteProps) {
  const { user, isLoading, isAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Staff and admins can access staff routes
  if (!user || !isAdmin) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}
