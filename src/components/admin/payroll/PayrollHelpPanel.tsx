import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export function PayrollHelpPanel() {
  return (
    <Alert className="mb-6">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Cómo Funciona el Payroll</AlertTitle>
      <AlertDescription>
        <ol className="list-decimal list-inside space-y-1 text-sm mt-2">
          <li>El staff debe tener configurado su <code className="text-xs bg-muted px-1 py-0.5 rounded">payroll_type</code> (hourly o per_assignment)</li>
          <li>El payroll se calcula automáticamente cuando los assignments se marcan como "completed"</li>
          <li>Para staff de Production: usa los tiempos de inicio y fin del package</li>
          <li>Para staff Custodial: usa el cleaning type y el optional celebration surcharge</li>
          <li>Marca items como "Paid" para llevar registro de pagos completados</li>
        </ol>
      </AlertDescription>
    </Alert>
  );
}
