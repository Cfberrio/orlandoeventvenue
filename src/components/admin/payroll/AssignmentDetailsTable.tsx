import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { usePayrollData, PayrollLineItem } from "@/hooks/usePayrollData";
import { supabase } from "@/integrations/supabase/client";
import PayrollItemEditModal from "./PayrollItemEditModal";

interface AssignmentDetailsTableProps {
  staffId: string;
  startDate: string;
  endDate: string;
}

export function AssignmentDetailsTable({ staffId, startDate, endDate }: AssignmentDetailsTableProps) {
  const [lineItems, setLineItems] = useState<PayrollLineItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<PayrollLineItem | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  
  const { fetchPayrollLineItems } = usePayrollData();

  useEffect(() => {
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

    loadLineItems();
  }, [staffId, startDate, endDate]);

  const handleEdit = (item: PayrollLineItem) => {
    setSelectedItem(item);
    setIsEditModalOpen(true);
  };

  const handleEditComplete = () => {
    setIsEditModalOpen(false);
    setSelectedItem(null);
    // Reload data
    const loadLineItems = async () => {
      const result = await fetchPayrollLineItems(startDate, endDate);
      if (result.data) {
        setLineItems(result.data);
      }
    };
    loadLineItems();
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
      <Table className="mt-2">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Booking / Assignment</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lineItems.map((item, index) => (
            <TableRow key={index}>
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
          ))}
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
    </>
  );
}
