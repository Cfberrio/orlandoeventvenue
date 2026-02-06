import { useState, useMemo } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { CalendarDays, Menu, X, LogOut, Package, Calendar, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useStaffSession } from "@/hooks/useStaffSession";
import { useNavigate } from "react-router-dom";

const baseNavItems = [
  { to: "/staff", icon: CalendarDays, label: "My Bookings", end: true },
  { to: "/staff/schedule", icon: Calendar, label: "Calendar" },
  { to: "/staff/standalone", icon: ClipboardList, label: "Standalone Assignments", roles: ["Custodial"] },
  { to: "/staff/inventory", icon: Package, label: "Inventory", roles: ["Custodial"] },
];

export default function StaffLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { staffMember, logout } = useStaffSession();
  const navigate = useNavigate();

  // Filter nav items based on staff role
  const navItems = useMemo(() => {
    return baseNavItems.filter(item => {
      // If item has no role restriction, show it to everyone
      if (!item.roles) return true;
      // If item has role restriction, check if staff member's role is included
      return item.roles.includes(staffMember?.role || "");
    });
  }, [staffMember?.role]);

  const handleSignOut = () => {
    logout();
    navigate("/staff/login");
  };

  return (
    <div className="min-h-screen flex w-full bg-background">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-foreground/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-card border-r border-border transform transition-transform duration-200 ease-in-out",
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <div className="flex items-center justify-between h-16 px-4 border-b border-border">
          <h1 className="text-lg font-semibold text-foreground">OEV Staff</h1>
          <Button 
            variant="ghost" 
            size="icon" 
            className="lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <nav className="p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive 
                  ? "bg-primary text-primary-foreground" 
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 border-b border-border bg-card flex items-center px-4 gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {staffMember?.full_name} ({staffMember?.role})
          </span>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
