import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Edit, Trash2, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import StandaloneAssignmentModal from "./StandaloneAssignmentModal";
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
import { usePayrollData } from "@/hooks/usePayrollData";

interface StandaloneAssignment {
  id: string;
  staff_id: string;
  scheduled_date: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  cleaning_type: string;
  celebration_surcharge: number;
  notes?: string;
  status: string;
  created_at: string;
  completed_at?: string;
  staff_members?: {
    full_name: string;
  };
}

interface StandaloneAssignmentsViewProps {
  startDate: string;
  endDate: string;
}

export default function StandaloneAssignmentsView({ 
  startDate, 
  endDate 
}: StandaloneAssignmentsViewProps) {
  const [assignments, setAssignments] = useState<StandaloneAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { toast } = useToast();
  const { deleteStandaloneAssignment, updateAssignment } = usePayrollData();

  const loadAssignments = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('booking_staff_assignments')
        .select(`
          id,
          staff_id,
          scheduled_date,
          scheduled_start_time,
          scheduled_end_time,
          cleaning_type,
          celebration_surcharge,
          notes,
          status,
          created_at,
          completed_at,
          staff_members (
            full_name
          )
        `)
        .is('booking_id', null) // Standalone only
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate)
        .order('scheduled_date', { ascending: false });

      if (error) throw error;

      setAssignments(data || []);
    } catch (err: any) {
      console.error('Error loading standalone assignments:', err);
      setError('Failed to load standalone assignments');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAssignments();
  }, [startDate, endDate]);

  const handleCreateSuccess = () => {
    setIsCreateModalOpen(false);
    loadAssignments();
    toast({
      title: "Assignment Created",
      description: "Standalone assignment has been created successfully",
    });
  };

  const handleDelete = async (assignmentId: string) => {
    const result = await deleteStandaloneAssignment(assignmentId);
    
    if (result.success) {
      toast({
        title: "Assignment Deleted",
        description: "Standalone assignment has been deleted",
      });
      loadAssignments();
    } else {
      toast({
        title: "Delete Failed",
        description: result.error?.message || "Failed to delete assignment",
        variant: "destructive",
      });
    }
    
    setDeleteConfirmId(null);
  };

  const handleMarkComplete = async (assignmentId: string) => {
    const result = await updateAssignment(assignmentId, {
      status: 'completed',
      completed_at: new Date().toISOString()
    });
    
    if (result.error) {
      toast({
        title: "Update Failed",
        description: "Failed to mark assignment as complete",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Assignment Completed",
        description: "Assignment marked as complete and payroll calculated",
      });
      loadAssignments();
    }
  };

  const calculateAmount = (cleaningType: string, surcharge: number) => {
    const baseRates: Record<string, number> = {
      touch_up: 40,
      regular: 80,
      deep: 150,
    };
    return (baseRates[cleaningType] || 0) + (surcharge || 0);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-96 w-full" />
        </CardContent>
      </Card>
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

  return (
    <>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Standalone Cleaning Assignments</CardTitle>
                <CardDescription>
                  Crea tareas de limpieza no vinculadas a bookings (preparación del venue, mantenimiento, etc.)
                </CardDescription>
              </div>
              <Button onClick={() => setIsCreateModalOpen(true)} size="default" className="gap-2">
                <Plus className="h-4 w-4" />
                Create Assignment
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {assignments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Plus className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <p className="font-medium mb-1">No hay standalone assignments</p>
                <p className="text-sm">Crea un assignment para limpiezas no vinculadas a bookings</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Cleaning Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((assignment) => {
                      const amount = calculateAmount(
                        assignment.cleaning_type,
                        assignment.celebration_surcharge
                      );

                      return (
                        <TableRow key={assignment.id}>
                          <TableCell className="font-medium">
                            {assignment.staff_members?.full_name || 'N/A'}
                          </TableCell>
                          <TableCell>
                            {format(new Date(assignment.scheduled_date), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {assignment.scheduled_start_time && assignment.scheduled_end_time
                              ? `${assignment.scheduled_start_time} - ${assignment.scheduled_end_time}`
                              : '-'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {assignment.cleaning_type.replace(/_/g, ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {assignment.celebration_surcharge > 0 
                              ? `$${assignment.celebration_surcharge.toFixed(2)}`
                              : '-'}
                          </TableCell>
                          <TableCell className="text-right font-bold">
                            ${amount.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                assignment.status === 'completed' ? 'default' :
                                assignment.status === 'in_progress' ? 'secondary' :
                                'outline'
                              }
                            >
                              {assignment.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                            {assignment.notes || '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              {assignment.status !== 'completed' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleMarkComplete(assignment.id)}
                                  title="Mark as complete"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteConfirmId(assignment.id)}
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Modal */}
      <StandaloneAssignmentModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Standalone Assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this standalone assignment and any associated payroll items.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
