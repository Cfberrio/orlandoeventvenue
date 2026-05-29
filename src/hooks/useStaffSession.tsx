import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  role: string;
  logged_in_at: string;
}

interface StaffSessionContextType {
  staffMember: StaffMember | null;
  isLoading: boolean;
  logout: () => void;
  refreshSession: () => Promise<void>;
}

const StaffSessionContext = createContext<StaffSessionContextType | undefined>(undefined);

export function StaffSessionProvider({ children }: { children: ReactNode }) {
  const [staffMember, setStaffMember] = useState<StaffMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = async () => {
    setIsLoading(true);
    try {
      const stored = localStorage.getItem("staff_session");
      if (!stored) {
        setStaffMember(null);
        return;
      }

      const session = JSON.parse(stored) as StaffMember;
      
      // Verify the staff member still exists and is active
      const { data, error } = await supabase
        .from("staff_members")
        .select("id, full_name, email, role, is_active")
        .eq("id", session.id)
        .eq("is_active", true)
        .maybeSingle();

      if (error || !data) {
        // Staff member no longer valid, clear session
        localStorage.removeItem("staff_session");
        setStaffMember(null);
        return;
      }

      // Update session with latest data
      const updatedSession = {
        ...session,
        full_name: data.full_name,
        email: data.email,
        role: data.role,
      };
      localStorage.setItem("staff_session", JSON.stringify(updatedSession));
      setStaffMember(updatedSession);
    } catch (error) {
      console.error("Error refreshing staff session:", error);
      localStorage.removeItem("staff_session");
      setStaffMember(null);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("staff_session");
    setStaffMember(null);
  };

  useEffect(() => {
    refreshSession();
  }, []);

  return (
    <StaffSessionContext.Provider value={{ staffMember, isLoading, logout, refreshSession }}>
      {children}
    </StaffSessionContext.Provider>
  );
}

export function useStaffSession() {
  const context = useContext(StaffSessionContext);
  if (context === undefined) {
    throw new Error("useStaffSession must be used within a StaffSessionProvider");
  }
  return context;
}
