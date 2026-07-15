import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUpdateStaffAssignment } from "@/hooks/useAdminData";
import { getAssignmentHours, isValidTimeRange, toTimeInputValue } from "@/lib/assignmentHours";

interface Props {
  assignment: any;
  bookingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function StaffHoursEditDialog({ assignment, bookingId, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const { mutateAsync, isPending } = useUpdateStaffAssignment();
  const [start, setStart] = useState(toTimeInputValue(assignment.scheduled_start_time));
  const [end, setEnd] = useState(toTimeInputValue(assignment.scheduled_end_time));

  // Reseed on open so a reopened dialog never shows a stale draft.
  useEffect(() => {
    if (open) {
      setStart(toTimeInputValue(assignment.scheduled_start_time));
      setEnd(toTimeInputValue(assignment.scheduled_end_time));
    }
  }, [open, assignment]);

  const inherited = getAssignmentHours({
    scheduledStartTime: null,
    scheduledEndTime: null,
    assignmentRole: assignment.assignment_role,
    packageName: assignment.booking?.package ?? null,
    packageStartTime: assignment.booking?.package_start_time ?? null,
    packageEndTime: assignment.booking?.package_end_time ?? null,
    bookingStartTime: assignment.booking?.start_time ?? null,
    bookingEndTime: assignment.booking?.end_time ?? null,
  });

  const save = async () => {
    if (!isValidTimeRange(start, end)) {
      toast({ title: "Horario inválido", description: "La hora de fin debe ser después del inicio.", variant: "destructive" });
      return;
    }
    try {
      await mutateAsync({ id: assignment.id, bookingId, scheduledStartTime: start, scheduledEndTime: end });
      toast({ title: "Horas del staff actualizadas" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "No se pudo actualizar", description: "Intenta de nuevo.", variant: "destructive" });
    }
  };

  const reset = async () => {
    try {
      await mutateAsync({ id: assignment.id, bookingId, scheduledStartTime: null, scheduledEndTime: null });
      toast({ title: "Horas restablecidas al horario del evento" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "No se pudo restablecer", description: "Intenta de nuevo.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar horas del staff</DialogTitle>
          <DialogDescription>Da a este staff un horario propio. Vacío = hereda el horario del evento.</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Horario heredado del evento: {inherited.start?.slice(0, 5)} – {inherited.end?.slice(0, 5)}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="staff-start">Inicio</Label>
            <Input id="staff-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staff-end">Fin</Label>
            <Input id="staff-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={reset} disabled={isPending}>Restablecer</Button>
          <Button onClick={save} disabled={isPending}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
