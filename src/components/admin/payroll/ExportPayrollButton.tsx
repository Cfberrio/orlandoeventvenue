import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ExportPayrollButtonProps {
  startDate: string;
  endDate: string;
  onExport: (
    startDate: string,
    endDate: string,
    filters?: {
      paidStatus?: 'pending' | 'paid' | 'all';
      staffId?: string;
      role?: string;
    }
  ) => Promise<any>;
}

export default function ExportPayrollButton({
  startDate,
  endDate,
  onExport,
}: ExportPayrollButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = async (filters?: any) => {
    setIsExporting(true);
    
    try {
      const result = await onExport(startDate, endDate, filters);
      
      if (result.success) {
        toast({
          title: "Export Successful",
          description: "Payroll data has been exported to CSV",
        });
      } else {
        throw new Error(result.error?.message || 'Export failed');
      }
    } catch (error: any) {
      console.error('Export error:', error);
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
          {isExporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Export to CSV
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Export Options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={() => handleExport()}>
          All Payroll Items
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={() => handleExport({ paidStatus: 'pending' })}>
          Unpaid Items Only
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={() => handleExport({ paidStatus: 'paid' })}>
          Paid Items Only
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          By Role
        </DropdownMenuLabel>
        
        <DropdownMenuItem onClick={() => handleExport({ role: 'Production' })}>
          Production Only
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={() => handleExport({ role: 'Custodial' })}>
          Custodial Only
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={() => handleExport({ role: 'Assistant' })}>
          Assistant Only
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
