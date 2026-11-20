import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { usePayrollData } from "@/hooks/usePayrollData";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyStateCard } from "./EmptyStateCard";
import { AssignmentDetailsTable } from "./AssignmentDetailsTable";
import ExportPayrollButton from "./ExportPayrollButton";
import MissingHoursCard from "./MissingHoursCard";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { money, payrollTotalsByStaff } from "@/lib/reportMoney";
import { staffRoleLabel } from "@/lib/statusLabels";

interface StaffPayrollData {
  staff_id: string;
  staff_name: string;
  staff_role: string;
  payroll_type: string;
  total_amount: number;
  paid_amount: number;
  pending_amount: number;
  not_payable_amount: number;
  assignment_count: number;
  hours_worked: number;
}

interface PayrollOverviewViewProps {
  startDate: string;
  endDate: string;
}

export default function PayrollOverviewView({ startDate, endDate }: PayrollOverviewViewProps) {
  const [data, setData] = useState<StaffPayrollData[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMarkPaidDialogOpen, setIsMarkPaidDialogOpen] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);

  const { fetchPayrollByStaff, fetchPayrollLineItems, markAsPaid, exportPayrollCsv } = usePayrollData();
  const { toast } = useToast();

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch payroll by staff
      const staffResult = await fetchPayrollByStaff(startDate, endDate);
      
      if (staffResult.error) {
        setError('Failed to load payroll data');
        console.error(staffResult.error);
        setIsLoading(false);
        return;
      }

      // Fetch line items to calculate paid/pending amounts
      const lineItemsResult = await fetchPayrollLineItems(startDate, endDate);
      
      if (lineItemsResult.data && staffResult.data) {
        // R2-17/R2-19: split by staff_id, and keep lines that are not owed
        // (staff never accepted, booking cancelled) out of owed/pending.
        const byStaff = payrollTotalsByStaff(lineItemsResult.data);
        const enrichedData = (staffResult.data as any[]).map((staff: any) => {
          const t = byStaff.get(staff.staff_id);
          return {
            ...staff,
            total_amount: t?.owed ?? Number(staff.total_amount),
            paid_amount: t?.paid ?? 0,
            pending_amount: t?.pending ?? 0,
            not_payable_amount: t?.notPayable ?? 0,
          };
        });

        setData(enrichedData);
      } else {
        setData(staffResult.data as any);
      }
    } catch (err: any) {
      console.error('Error loading payroll data:', err);
      setError('Failed to load payroll data');
    }
    
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [startDate, endDate]);

  const toggleRow = (staffId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(staffId)) {
      newExpanded.delete(staffId);
    } else {
      newExpanded.add(staffId);
    }
    setExpandedRows(newExpanded);
  };

  const toggleSelect = (staffId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(staffId)) {
      newSelected.delete(staffId);
    } else {
      newSelected.add(staffId);
    }
    setSelectedIds(newSelected);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked && data) {
      const allIds = data
        .filter(staff => staff.pending_amount > 0)
        .map(staff => staff.staff_id);
      setSelectedIds(new Set(allIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleMarkSelectedAsPaid = async () => {
    if (selectedIds.size === 0) return;
    setIsMarkingPaid(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('No authenticated user');
      }

      // Get line items for selected staff
      const lineItemsResult = await fetchPayrollLineItems(startDate, endDate);
      
      if (lineItemsResult.data && data) {
        // By staff_id, and only lines that are owed: a line whose staff never
        // accepted or whose booking is cancelled is refused by the DB.
        const payrollItemIds = lineItemsResult.data
          .filter((item) =>
            item.staff_id != null &&
            selectedIds.has(item.staff_id) &&
            item.paid_status === 'pending' &&
            !item.not_payable_reason &&
            item.payroll_item_id
          )
          .map((item) => item.payroll_item_id);

        if (payrollItemIds.length > 0) {
          await markAsPaid(payrollItemIds, user.id);
          
          toast({
            title: "Payroll marked as paid",
            description: `${payrollItemIds.length} items marked as paid`,
          });

          // Reload data
          await loadData();
          setSelectedIds(new Set());
        } else {
          toast({
            title: "No pending items to mark",
            variant: "destructive",
          });
        }
      }
    } catch (error: any) {
      console.error('Error marking as paid:', error);
      toast({
        title: "Error marking as paid",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsMarkingPaid(false);
      setIsMarkPaidDialogOpen(false);
    }
  };

  const totalAmount = data?.reduce((sum, item) => sum + Number(item.total_amount), 0) || 0;
  const totalPaid = data?.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0) || 0;
  const totalPending = data?.reduce((sum, item) => sum + Number(item.pending_amount || 0), 0) || 0;
  const totalNotPayable = data?.reduce((sum, item) => sum + Number(item.not_payable_amount || 0), 0) || 0;
  const staffOptions = (data ?? []).map((s) => ({ staff_id: s.staff_id, staff_name: s.staff_name }));

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="space-y-4">
      <MissingHoursCard onChanged={loadData} />
      <Card>
        <CardContent className="pt-6">
          <EmptyStateCard
            title="No Payroll Data"
            description="Payroll is generated when staff assignments are marked as 'completed'. Visit the Bookings page to complete assignments."
            actionText="View Bookings"
            actionLink="/admin/bookings"
          />
        </CardContent>
      </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MissingHoursCard onChanged={loadData} />
      {/* Main Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Staff Payroll</CardTitle>
              <CardDescription>
                Complete payroll breakdown by staff member
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={() => setIsMarkPaidDialogOpen(true)} 
                disabled={selectedIds.size === 0 || isMarkingPaid}
                variant="default"
              >
                {isMarkingPaid && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Mark Selected as Paid ({selectedIds.size})
              </Button>
              <ExportPayrollButton 
                startDate={startDate}
                endDate={endDate}
                onExport={exportPayrollCsv}
                staff={staffOptions}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox 
                      onCheckedChange={handleSelectAll}
                      checked={selectedIds.size > 0 && selectedIds.size === data.filter(s => s.pending_amount > 0).length}
                    />
                  </TableHead>
                  <TableHead>Staff Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Assignments</TableHead>
                  <TableHead className="text-right">Total Owed</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right" title="Lines not owed: the staff member never accepted, or the booking was cancelled. Not in Total Owed and cannot be marked paid.">
                    Not payable
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((staff) => (
                  <>
                    <TableRow 
                      key={staff.staff_id}
                      className="cursor-pointer hover:bg-muted/50"
                    >
                      <TableCell>
                        <Checkbox 
                          checked={selectedIds.has(staff.staff_id)}
                          onCheckedChange={() => toggleSelect(staff.staff_id)}
                          disabled={staff.pending_amount === 0}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => toggleRow(staff.staff_id)}
                          >
                            {expandedRows.has(staff.staff_id) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                          {staff.staff_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{staffRoleLabel(staff.staff_role)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{staff.assignment_count}</TableCell>
                      <TableCell className="text-right font-bold">
                        {money(staff.total_amount)}
                      </TableCell>
                      <TableCell className="text-right text-green-600 font-medium">
                        {money(staff.paid_amount || 0)}
                      </TableCell>
                      <TableCell className="text-right text-orange-600 font-medium">
                        {money(staff.pending_amount || 0)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {Number(staff.not_payable_amount || 0) !== 0 ? money(staff.not_payable_amount) : "-"}
                      </TableCell>
                    </TableRow>
                    
                    {/* Expanded row with details */}
                    {expandedRows.has(staff.staff_id) && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/20 p-4">
                          <AssignmentDetailsTable 
                            staffId={staff.staff_id}
                            startDate={startDate}
                            endDate={endDate}
                            onDataChanged={loadData}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
                
                {/* Totals Row */}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell></TableCell>
                  <TableCell>TOTAL</TableCell>
                  <TableCell colSpan={2}></TableCell>
                  <TableCell className="text-right">
                    {money(totalAmount)}
                  </TableCell>
                  <TableCell className="text-right text-green-600">
                    {money(totalPaid)}
                  </TableCell>
                  <TableCell className="text-right text-orange-600">
                    {money(totalPending)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {money(totalNotPayable)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Mark as Paid Confirmation Dialog */}
      <AlertDialog open={isMarkPaidDialogOpen} onOpenChange={setIsMarkPaidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Payment</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to mark {selectedIds.size} staff member(s) as paid.
              This updates their pending items that are owed. Lines marked "not payable"
              (staff never accepted, or booking cancelled) are left as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMarkingPaid}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleMarkSelectedAsPaid}
              disabled={isMarkingPaid}
            >
              {isMarkingPaid ? 'Processing...' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
