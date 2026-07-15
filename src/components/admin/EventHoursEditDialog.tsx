import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUpdateBookingTimes } from "@/hooks/useAdminData";
import { isValidTimeRange } from "@/lib/assignmentHours";

interface Props {
  bookingId: string;
  startTime: string | null;
  endTime: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const toInput = (t: string | null) => (t ? t.slice(0, 5) : "");

export default function EventHoursEditDialog({ bookingId, startTime, endTime, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const { mutateAsync, isPending } = useUpdateBookingTimes();
  const [start, setStart] = useState(toInput(startTime));
  const [end, setEnd] = useState(toInput(endTime));

  useEffect(() => {
    if (open) {
      setStart(toInput(startTime));
      setEnd(toInput(endTime));
    }
  }, [open, startTime, endTime]);

  const save = async () => {
    if (!isValidTimeRange(start, end)) {
      toast({ title: "Horario inválido", description: "La hora de fin debe ser después del inicio.", variant: "destructive" });
      return;
    }
    try {
      await mutateAsync({ bookingId, startTime: start, endTime: end });
      toast({ title: "Horario del evento actualizado" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "No se pudo actualizar", description: "Intenta de nuevo.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar horario del evento</DialogTitle>
          <DialogDescription>Cambia la hora de inicio y fin del evento. Afecta las horas derivadas de todo el staff.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="event-start">Inicio</Label>
            <Input id="event-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-end">Fin</Label>
            <Input id="event-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={isPending}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
