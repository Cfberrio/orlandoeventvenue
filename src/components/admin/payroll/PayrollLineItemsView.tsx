import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Edit, CheckCircle, Clock, Loader2 } from "lucide-react";
import { usePayrollData, PayrollLineItem } from "@/hooks/usePayrollData";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import PayrollItemEditModal from "./PayrollItemEditModal";

interface PayrollLineItemsViewProps {
  startDate: string;
  endDate: string;
}

export default function PayrollLineItemsView({ startDate, endDate }: PayrollLineItemsViewProps) {
  const [data, setData] = useState<PayrollLineItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterPaidStatus, setFilterPaidStatus] = useState<string>("all");
  const [filterPayCategory, setFilterPayCategory] = useState<string>("all");
  const [selectedItem, setSelectedItem] = useState<PayrollLineItem | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isMarkPaidDialogOpen, setIsMarkPaidDialogOpen] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);

  const { fetchPayrollLineItems, markAsPaid } = usePayrollData();
  const { toast } = useToast();

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    
    const result = await fetchPayrollLineItems(startDate, endDate);
    
    if (result.error) {
      setError('Failed to load payroll line items');
      console.error(result.error);
    } else {
      setData(result.data);
    }
    
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [startDate, endDate]);

  const handleEdit = (item: PayrollLineItem) => {
    setSelectedItem(item);
    setIsEditModalOpen(true);
  };

  const handleEditComplete = () => {
    setIsEditModalOpen(false);
    setSelectedItem(null);
    loadData(); // Reload data after edit
  };

  const handleToggleSelect = (index: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedIds(newSelected);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const pendingIndices = filteredData
        .map((item, index) => item.paid_status === 'pending' ? index : -1)
        .filter(i => i !== -1);
      setSelectedIds(new Set(pendingIndices));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleMarkAsPaid = async () => {
    setIsMarkingPaid(true);
    
    try {
      // Get current admin user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('No authenticated user');
      }

      // Get payroll item IDs from selected items
      // We need to query the actual payroll_items table to get IDs
      const selectedItems = Array.from(selectedIds).map(index => filteredData[index]);
      
      // Query staff_payroll_items to get the IDs
      const itemPromises = selectedItems.map(async (item) => {
        // Find payroll items by staff_id and matching amount/category
        const { data: staffData } = await supabase
          .from('staff_members')
          .select('id')
          .eq('full_name', item.staff_name)
          .single();

        if (!staffData) return null;

        const { data } = await supabase
          .from('staff_payroll_items')
          .select('id')
          .eq('staff_id', staffData.id)
          .eq('pay_category', item.pay_category)
          .eq('amount', item.amount)
          .limit(1)
          .maybeSingle();
        
        return data?.id;
      });
      
      const payrollItemIds = (await Promise.all(itemPromises)).filter(id => id) as string[];
      
      if (payrollItemIds.length === 0) {
        throw new Error('No payroll items found to mark as paid');
      }

      // Get admin staff_id (if admin is also in staff_members)
      const { data: adminStaff } = await supabase
        .from('staff_members')
        .select('id')
        .eq('email', user.email)
        .single();

      const result = await markAsPaid(payrollItemIds, adminStaff?.id || user.id);
      
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to mark as paid');
      }

      toast({
        title: "Items Marked as Paid",
        description: `${result.count} payroll items have been marked as paid`,
      });

      setSelectedIds(new Set());
      setIsMarkPaidDialogOpen(false);
      loadData();
    } catch (error: any) {
      console.error('Error marking as paid:', error);
      toast({
        title: "Failed to Mark as Paid",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsMarkingPaid(false);
    }
  };

  // Apply filters
  const filteredData = data?.filter((item) => {
    if (filterPaidStatus !== "all" && item.paid_status !== filterPaidStatus) {
      return false;
    }
    if (filterPayCategory !== "all" && item.pay_category !== filterPayCategory) {
      return false;
    }
    return true;
  }) || [];

  const totalAmount = filteredData.reduce((sum, item) => sum + Number(item.amount), 0);
  const selectedCount = selectedIds.size;
  const selectedTotal = Array.from(selectedIds).reduce((sum, index) => {
    return sum + Number(filteredData[index]?.amount || 0);
  }, 0);
  const pendingItems = filteredData.filter(item => item.paid_status === 'pending');
  const allPendingSelected = pendingItems.length > 0 && 
    pendingItems.every((_, index) => selectedIds.has(index));

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-96 w-full" />
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
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">No payroll line items found for this date range</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle>Filters</CardTitle>
              <div className="flex gap-4">
                <Select value={filterPaidStatus} onValueChange={setFilterPaidStatus}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={filterPayCategory} onValueChange={setFilterPayCategory}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    <SelectItem value="cleaning_base">Cleaning Base</SelectItem>
                    <SelectItem value="celebration_surcharge">Celebration Surcharge</SelectItem>
                    <SelectItem value="production_hours">Production Hours</SelectItem>
                    <SelectItem value="bonus">Bonus</SelectItem>
                    <SelectItem value="deduction">Deduction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <CardTitle>Payroll Line Items</CardTitle>
                <div className="text-sm text-muted-foreground mt-1">
                  Showing {filteredData.length} of {data.length} items
                  {selectedCount > 0 && (
                    <span className="ml-2 font-semibold">
                      • {selectedCount} selected (${selectedTotal.toFixed(2)})
                    </span>
                  )}
                </div>
              </div>
              {selectedCount > 0 && (
                <Button 
                  onClick={() => setIsMarkPaidDialogOpen(true)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Mark {selectedCount} as Paid
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={allPendingSelected}
                        onCheckedChange={handleSelectAll}
                        aria-label="Select all pending items"
                      />
                    </TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Booking #</TableHead>
                    <TableHead>Assignment</TableHead>
                    <TableHead>Pay Category</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(index)}
                          onCheckedChange={() => handleToggleSelect(index)}
                          disabled={item.paid_status === 'paid'}
                          aria-label={`Select ${item.staff_name}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{item.staff_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.staff_role}</Badge>
                      </TableCell>
                      <TableCell>
                        {format(new Date(item.assignment_date), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.reservation_number || (
                          <span className="italic">Standalone</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{item.assignment_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            item.pay_category === 'bonus' ? 'default' :
                            item.pay_category === 'deduction' ? 'destructive' :
                            'secondary'
                          }
                        >
                          {item.pay_category.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {item.hours ? Number(item.hours).toFixed(2) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.rate ? `$${Number(item.rate).toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        ${Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        {item.paid_status === 'paid' ? (
                          <Badge variant="default" className="bg-green-600">
                            <CheckCircle className="mr-1 h-3 w-3" />
                            Paid
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <Clock className="mr-1 h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(item)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  
                  {/* Totals Row */}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell></TableCell>
                    <TableCell colSpan={8}>TOTAL</TableCell>
                    <TableCell className="text-right">
                      ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Modal */}
      {selectedItem && (
        <PayrollItemEditModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSuccess={handleEditComplete}
          item={selectedItem}
        />
      )}

      {/* Mark as Paid Confirmation Dialog */}
      <AlertDialog open={isMarkPaidDialogOpen} onOpenChange={setIsMarkPaidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Items as Paid?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to mark {selectedCount} payroll item{selectedCount !== 1 ? 's' : ''} as paid,
              totaling ${selectedTotal.toFixed(2)}. This action will record that these payments have been
              completed and track who marked them as paid.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMarkingPaid}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMarkAsPaid}
              disabled={isMarkingPaid}
              className="bg-green-600 hover:bg-green-700"
            >
              {isMarkingPaid && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
