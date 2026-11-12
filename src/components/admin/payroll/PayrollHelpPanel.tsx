import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export function PayrollHelpPanel() {
  return (
    <Alert className="mb-6">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>How Payroll Works</AlertTitle>
      <AlertDescription>
        <ol className="list-decimal list-inside space-y-1 text-sm mt-2">
          <li><strong>Production</strong> staff: paid hourly ($50/hr) on the hours worked; if none are entered, on the custom hours set on the Staff tab, otherwise the production package start/end times</li>
          <li><strong>Custodial & Assistant</strong> staff: paid per assignment based on cleaning type (Touch-up $40, Regular $80, Deep $150) plus celebration surcharge ($20-$70)</li>
          <li>Payroll is calculated automatically when assignments are marked as "completed". This happens after the event (when the booking moves to Post Event), and only for staff who <strong>accepted</strong> the assignment</li>
          <li>Unpaid pay lines are removed automatically when staff reject or unassign, or when the booking is cancelled. Paid lines and bonuses/deductions are kept</li>
          <li>Standalone assignments (not linked to a booking) also generate payroll when completed</li>
          <li>Use the checkboxes to select staff and mark their payroll items as "Paid" to track completed payments</li>
        </ol>
      </AlertDescription>
    </Alert>
  );
}
