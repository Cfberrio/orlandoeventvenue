import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PayrollExportFilters, PayrollExportResult } from "@/hooks/usePayrollData";

interface ExportPayrollButtonProps {
  startDate: string;
  endDate: string;
  onExport: (startDate: string, endDate: string, filters?: PayrollExportFilters) => Promise<PayrollExportResult>;
  /** Staff shown in the current range, for the per-staff export (R2-19). */
  staff?: { staff_id: string; staff_name: string }[];
}

// Role codes as stored in staff_members.role.
const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "Production", label: "Production" },
  { value: "Custodial", label: "Custodial" },
  { value: "cleaner", label: "Cleaner" },
  { value: "Assistant", label: "Assistant" },
  { value: "Bar Vendor", label: "Bar Vendor" },
];

export default function ExportPayrollButton({ startDate, endDate, onExport, staff = [] }: ExportPayrollButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = async (filters?: PayrollExportFilters) => {
    setIsExporting(true);
    try {
      const result = await onExport(startDate, endDate, filters);
      if (result.success) {
        toast({ title: "Export Successful", description: "Payroll data has been exported to CSV" });
      } else if (result.empty) {
        // R2-20: nothing was downloaded, so do not say it was.
        toast({ title: "Nothing to export", description: "No rows in this range" });
      } else {
        throw new Error(result.error?.message || "Export failed");
      }
    } catch (error: any) {
      console.error("Export error:", error);
      toast({
        title: "Export Failed",
        description: error.message || "Failed to export payroll data",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={isExporting}>
          {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Export to CSV
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Export Options</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => handleExport()}>All Payroll Items</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport({ paidStatus: "pending" })}>Unpaid Items Only</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport({ paidStatus: "paid" })}>Paid Items Only</DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={staff.length === 0}>By Staff Member</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {staff.map((s) => (
              <DropdownMenuItem key={s.staff_id} onClick={() => handleExport({ staffId: s.staff_id })}>
                {s.staff_name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">By Role</DropdownMenuLabel>
        {ROLE_OPTIONS.map((r) => (
          <DropdownMenuItem key={r.value} onClick={() => handleExport({ role: r.value })}>
            {r.label} Only
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
