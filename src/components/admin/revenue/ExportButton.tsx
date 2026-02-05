import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ExportButtonProps {
  startDate: string;
  endDate: string;
  onExport: (startDate: string, endDate: string) => Promise<{ success: boolean; error: any }>;
}

export default function ExportButton({ startDate, endDate, onExport }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    
    try {
      const result = await onExport(startDate, endDate);
      
      if (result.success) {
        toast.success("Revenue data exported successfully");
      } else {
        toast.error("Failed to export revenue data");
        console.error('Export error:', result.error);
      }
    } catch (error) {
      toast.error("Failed to export revenue data");
      console.error('Export error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button 
      onClick={handleExport} 
      disabled={isExporting}
      variant="default"
      size="default"
    >
      {isExporting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Exporting...
        </>
      ) : (
        <>
          <Download className="mr-2 h-4 w-4" />
          Export to CSV
        </>
      )}
    </Button>
  );
}
