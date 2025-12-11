import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useStaffSession } from "@/hooks/useStaffSession";

export default function StaffLogin() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { refreshSession } = useStaffSession();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim()) {
      toast({ title: "Please enter your email", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      // Check if email exists in staff_members and is active
      const { data: staffMember, error } = await supabase
        .from("staff_members")
        .select("id, full_name, email, role, is_active")
        .eq("email", email.trim().toLowerCase())
        .maybeSingle();

      if (error) throw error;

      if (!staffMember) {
        toast({ 
          title: "Access Denied", 
          description: "This email is not registered as a staff member.",
          variant: "destructive" 
        });
        return;
      }

      if (!staffMember.is_active) {
        toast({ 
          title: "Account Inactive", 
          description: "Your staff account is currently inactive. Please contact an administrator.",
          variant: "destructive" 
        });
        return;
      }

      // Store staff session in localStorage
      localStorage.setItem("staff_session", JSON.stringify({
        id: staffMember.id,
        full_name: staffMember.full_name,
        email: staffMember.email,
        role: staffMember.role,
        logged_in_at: new Date().toISOString(),
      }));

      // Refresh the session context to pick up the new session
      await refreshSession();

      toast({ title: `Welcome, ${staffMember.full_name}!` });
      navigate("/staff");
    } catch (error) {
      console.error("Login error:", error);
      toast({ 
        title: "Login failed", 
        description: "An error occurred. Please try again.",
        variant: "destructive" 
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Staff Login</CardTitle>
          <CardDescription>
            Enter your staff email to access your assigned bookings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="your.email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Access Dashboard
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
