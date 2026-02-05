import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePayrollData, PayrollByRole } from "@/hooks/usePayrollData";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface PayrollByRoleViewProps {
  startDate: string;
  endDate: string;
}

export default function PayrollByRoleView({ startDate, endDate }: PayrollByRoleViewProps) {
  const [data, setData] = useState<PayrollByRole[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { fetchPayrollByRole } = usePayrollData();

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      
      const result = await fetchPayrollByRole(startDate, endDate);
      
      if (result.error) {
        setError('Failed to load payroll by role data');
        console.error(result.error);
      } else {
        setData(result.data);
      }
      
      setIsLoading(false);
    };

    loadData();
  }, [startDate, endDate]);

  const totalAmount = data?.reduce((sum, item) => sum + Number(item.total_amount), 0) || 0;
  const totalStaff = data?.reduce((sum, item) => sum + Number(item.staff_count), 0) || 0;
  const totalAssignments = data?.reduce((sum, item) => sum + Number(item.assignment_count), 0) || 0;
  const totalHours = data?.reduce((sum, item) => sum + Number(item.total_hours || 0), 0) || 0;

  // Format data for chart
  const chartData = data?.map((role) => ({
    role: role.staff_role,
    'Total Pay': Number(role.total_amount),
    'Avg per Staff': Number(role.avg_per_staff),
    'Staff Count': Number(role.staff_count),
  })) || [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-80 w-full" />
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
      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Payroll Comparison by Role</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="role" />
              <YAxis 
                yAxisId="left"
                tickFormatter={(value) => `$${value.toLocaleString()}`}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                tickFormatter={(value) => value.toString()}
              />
              <Tooltip 
                formatter={(value: number, name: string) => {
                  if (name === 'Staff Count') return value;
                  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
                }}
              />
              <Legend />
              <Bar yAxisId="left" dataKey="Total Pay" fill="#3b82f6" />
              <Bar yAxisId="left" dataKey="Avg per Staff" fill="#8b5cf6" />
              <Bar yAxisId="right" dataKey="Staff Count" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detailed Table */}
      <Card>
        <CardHeader>
          <CardTitle>Payroll Summary by Role</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Pay Type</TableHead>
                  <TableHead className="text-right">Staff Count</TableHead>
                  <TableHead className="text-right">Assignments</TableHead>
                  <TableHead className="text-right">Total Hours</TableHead>
                  <TableHead className="text-right">Total Pay</TableHead>
                  <TableHead className="text-right">Avg per Staff</TableHead>
                  <TableHead className="text-right">Avg per Assignment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((role, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{role.staff_role}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {role.payroll_type === 'hourly' ? 'Hourly' : 'Per Assignment'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{role.staff_count}</TableCell>
                    <TableCell className="text-right">{role.assignment_count}</TableCell>
                    <TableCell className="text-right">
                      {role.payroll_type === 'hourly' 
                        ? Number(role.total_hours || 0).toFixed(2) 
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      ${Number(role.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(role.avg_per_staff).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      ${Number(role.avg_per_assignment).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
                
                {/* Totals Row */}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right">{totalStaff}</TableCell>
                  <TableCell className="text-right">{totalAssignments}</TableCell>
                  <TableCell className="text-right">{totalHours.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${(totalAmount / totalStaff).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${(totalAmount / totalAssignments).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
