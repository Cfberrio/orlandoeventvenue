import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Edit, Loader2, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { usePayrollData, PayrollLineItem } from "@/hooks/usePayrollData";
import { supabase } from "@/integrations/supabase/client";
import PayrollItemEditModal from "./PayrollItemEditModal";
import { useToast } from "@/hooks/use-toast";

interface AssignmentDetailsTableProps {
  staffId: string;
  startDate: string;
  endDate: string;
  onDataChanged?: () => void;
}

export function AssignmentDetailsTable({ staffId, startDate, endDate, onDataChanged }: AssignmentDetailsTableProps) {
  const [lineItems, setLineItems] = useState<PayrollLineItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<PayrollLineItem | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [isMarkPaidDialogOpen, setIsMarkPaidDialogOpen] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  
  const { fetchPayrollLineItems, markAsPaid } = usePayrollData();
  const { toast } = useToast();

  const loadLineItems = async () => {
    setIsLoading(true);
    const result = await fetchPayrollLineItems(startDate, endDate);
    
    if (result.data) {
      // Filter by staff_id - we need to match via staff_members table
      const { data: staffData } = await supabase
        .from('staff_members')
        .select('full_name')
        .eq('id', staffId)
        .single();
      
      const staffName = staffData?.full_name;
      const filtered = staffName 
        ? result.data.filter((item: any) => item.staff_name === staffName)
        : result.data;
      
      setLineItems(filtered);
    }
    
    setIsLoading(false);
  };

  useEffect(() => {
    loadLineItems();
  }, [staffId, startDate, endDate]);

  const pendingItems = lineItems.filter(item => item.paid_status === 'pending' && item.payroll_item_id);

  const toggleItemSelect = (payrollItemId: string) => {
    const newSelected = new Set(selectedItemIds);
    if (newSelected.has(payrollItemId)) {
      newSelected.delete(payrollItemId);
    } else {
      newSelected.add(payrollItemId);
    }
    setSelectedItemIds(newSelected);
  };

  const handleSelectAllPending = (checked: boolean) => {
    if (checked) {
      const allPendingIds = pendingItems.map(item => item.payroll_item_id);
      setSelectedItemIds(new Set(allPendingIds));
    } else {
      setSelectedItemIds(new Set());
    }
  };

  const handleMarkSelectedAsPaid = async () => {
    if (selectedItemIds.size === 0) return;
    setIsMarkingPaid(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('No authenticated user');
      }

      const payrollItemIds = Array.from(selectedItemIds);
      await markAsPaid(payrollItemIds, user.id);

      toast({
        title: "Payroll marked as paid",
        description: `${payrollItemIds.length} item(s) marked as paid`,
      });

      setSelectedItemIds(new Set());
      await loadLineItems();
      onDataChanged?.();
    } catch (error: any) {
      console.error('Error marking items as paid:', error);
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

  const handleEdit = (item: PayrollLineItem) => {
    setSelectedItem(item);
    setIsEditModalOpen(true);
  };

  const handleEditComplete = () => {
    setIsEditModalOpen(false);
    setSelectedItem(null);
    loadLineItems();
    onDataChanged?.();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!lineItems || lineItems.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        No assignment details found
      </div>
    );
  }

  return (
    <>
      {/* Mark as Paid action bar */}
      {selectedItemIds.size > 0 && (
        <div className="flex items-center gap-3 mb-2 p-2 rounded-md bg-primary/5 border border-primary/20">
          <CheckCircle className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            {selectedItemIds.size} item(s) selected
          </span>
          <Button
            size="sm"
            onClick={() => setIsMarkPaidDialogOpen(true)}
            disabled={isMarkingPaid}
          >
            {isMarkingPaid && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Mark Selected as Paid
          </Button>
        </div>
      )}

      <Table className="mt-2">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={pendingItems.length > 0 && selectedItemIds.size === pendingItems.length}
                onCheckedChange={handleSelectAllPending}
                disabled={pendingItems.length === 0}
              />
            </TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Booking / Assignment</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lineItems.map((item, index) => {
            const isPending = item.paid_status === 'pending' && item.payroll_item_id;
            return (
              <TableRow key={index}>
                <TableCell>
                  <Checkbox
                    checked={selectedItemIds.has(item.payroll_item_id)}
                    onCheckedChange={() => toggleItemSelect(item.payroll_item_id)}
                    disabled={!isPending}
                  />
                </TableCell>
                <TableCell className="text-sm">
                  {item.assignment_date ? format(new Date(item.assignment_date), 'MMM dd, yyyy') : '-'}
                </TableCell>
                <TableCell className="text-sm">
                  {item.booking_id ? (
                    <Link 
                      to={`/admin/bookings/${item.booking_id}`}
                      className="text-primary hover:underline"
                    >
                      {item.reservation_number || `Booking ${item.booking_id.slice(0, 8)}`}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Standalone</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {item.pay_type || item.pay_category}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-medium">
                  ${Number(item.amount).toFixed(2)}
                </TableCell>
                <TableCell className="text-right">
                  <Badge 
                    variant={item.paid_status === 'paid' ? 'default' : 'secondary'}
                  >
                    {item.paid_status === 'paid' ? 'Paid' : 'Pending'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => handleEdit(item)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {selectedItem && (
        <PayrollItemEditModal
          item={selectedItem}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSuccess={handleEditComplete}
        />
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={isMarkPaidDialogOpen} onOpenChange={setIsMarkPaidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Payment</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to mark {selectedItemIds.size} payroll item(s) as paid.
              This will update only the selected assignments.
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
    </>
  );
}
