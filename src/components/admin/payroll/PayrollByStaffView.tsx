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
import { ChevronDown, ChevronRight, DollarSign } from "lucide-react";
import { usePayrollData, PayrollByStaff } from "@/hooks/usePayrollData";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface PayrollByStaffViewProps {
  startDate: string;
  endDate: string;
}

export default function PayrollByStaffView({ startDate, endDate }: PayrollByStaffViewProps) {
  const [data, setData] = useState<PayrollByStaff[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [filterStaff, setFilterStaff] = useState<string>("all");

  const { fetchPayrollByStaff } = usePayrollData();

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      
      const result = await fetchPayrollByStaff(
        startDate, 
        endDate, 
        filterStaff === "all" ? undefined : filterStaff
      );
      
      if (result.error) {
        setError('Failed to load payroll by staff data');
        console.error(result.error);
      } else {
        setData(result.data);
      }
      
      setIsLoading(false);
    };

    loadData();
  }, [startDate, endDate, filterStaff]);

  const toggleRow = (staffId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(staffId)) {
      newExpanded.delete(staffId);
    } else {
      newExpanded.add(staffId);
    }
    setExpandedRows(newExpanded);
  };

  const totalAmount = data?.reduce((sum, item) => sum + Number(item.total_amount), 0) || 0;
  const totalHours = data?.reduce((sum, item) => sum + Number(item.hours_worked || 0), 0) || 0;
  const totalAssignments = data?.reduce((sum, item) => sum + Number(item.assignment_count), 0) || 0;

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
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">No payroll data found for this date range</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Filter by Staff</CardTitle>
            <Select value={filterStaff} onValueChange={setFilterStaff}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Staff</SelectItem>
                {data.map((staff) => (
                  <SelectItem key={staff.staff_id} value={staff.staff_id}>
                    {staff.staff_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      {/* Main Table */}
      <Card>
        <CardHeader>
          <CardTitle>Payroll by Staff Member</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Staff Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Pay Type</TableHead>
                  <TableHead className="text-right">Assignments</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Total Owed</TableHead>
                  <TableHead className="text-right">Avg/Assignment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((staff) => (
                  <>
                    <TableRow 
                      key={staff.staff_id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleRow(staff.staff_id)}
                    >
                      <TableCell>
                        {expandedRows.has(staff.staff_id) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{staff.staff_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{staff.staff_role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {staff.payroll_type === 'hourly' ? 'Hourly' : 'Per Assignment'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{staff.assignment_count}</TableCell>
                      <TableCell className="text-right">
                        {staff.payroll_type === 'hourly' 
                          ? Number(staff.hours_worked || 0).toFixed(2) 
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        ${Number(staff.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        ${Number(staff.avg_per_assignment).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                    
                    {/* Expanded row - placeholder for detailed breakdown */}
                    {expandedRows.has(staff.staff_id) && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/20 p-4">
                          <div className="text-sm text-muted-foreground">
                            Detailed breakdown for {staff.staff_name} - {staff.assignment_count} assignments
                            <br />
                            Total: ${Number(staff.total_amount).toFixed(2)}
                          </div>
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
                  <TableCell className="text-right">{totalAssignments}</TableCell>
                  <TableCell className="text-right">{totalHours.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
