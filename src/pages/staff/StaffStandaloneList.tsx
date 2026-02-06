import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  ClipboardList, 
  Calendar, 
  Clock, 
  DollarSign, 
  FileText,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { useStaffStandaloneAssignments } from "@/hooks/useStandaloneCleaningData";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default function StaffStandaloneList() {
  const { data: assignments, isLoading } = useStaffStandaloneAssignments();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96 mt-2" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  const getCleaningTypeLabel = (type: string | null) => {
    if (!type) return 'N/A';
    switch (type) {
      case 'touch_up':
        return 'Touch-Up Cleaning ($40)';
      case 'regular':
        return 'Regular Cleaning ($80)';
      case 'deep':
        return 'Deep Cleaning ($150)';
      default:
        return type;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500">Completado</Badge>;
      case 'assigned':
        return <Badge className="bg-blue-500">Asignado</Badge>;
      case 'in_progress':
        return <Badge className="bg-yellow-500">En Progreso</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-primary" />
            <div>
              <CardTitle className="text-2xl">Mis Asignaciones Standalone</CardTitle>
              <CardDescription className="mt-1">
                Tareas de limpieza y preparación del venue no ligadas a bookings
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Empty State */}
      {!assignments || assignments.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ClipboardList className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No tienes asignaciones standalone</h3>
            <p className="text-muted-foreground mb-6">
              Las asignaciones de limpieza independientes aparecerán aquí cuando sean creadas por el administrador.
            </p>
          </CardContent>
        </Card>
      ) : (
        /* Assignments List */
        <div className="grid gap-4">
          {assignments.map((assignment) => (
            <Card key={assignment.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="pt-6">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  {/* Left: Assignment Details */}
                  <div className="flex-1 space-y-3">
                    <div className="flex items-start gap-3">
                      <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">Fecha</p>
                        <p className="font-semibold">
                          {assignment.scheduled_date 
                            ? format(new Date(assignment.scheduled_date), 'PPP', { locale: es })
                            : 'Sin fecha'}
                        </p>
                      </div>
                    </div>

                    {assignment.scheduled_start_time && (
                      <div className="flex items-start gap-3">
                        <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm text-muted-foreground">Hora</p>
                          <p className="font-medium">
                            {assignment.scheduled_start_time.slice(0, 5)}
                            {assignment.scheduled_end_time && 
                              ` - ${assignment.scheduled_end_time.slice(0, 5)}`}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-start gap-3">
                      <DollarSign className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Tipo de Limpieza</p>
                        <Badge variant="secondary" className="font-medium">
                          {getCleaningTypeLabel(assignment.cleaning_type)}
                        </Badge>
                        {assignment.celebration_surcharge && assignment.celebration_surcharge > 0 && (
                          <Badge variant="outline" className="ml-2">
                            Celebration Surcharge: ${assignment.celebration_surcharge}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {assignment.notes && (
                      <div className="flex items-start gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm text-muted-foreground">Notas</p>
                          <p className="text-sm">{assignment.notes}</p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-2">
                      <span className="text-sm text-muted-foreground">Estado:</span>
                      {getStatusBadge(assignment.status)}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex flex-col gap-2 md:items-end">
                    {assignment.status === 'completed' ? (
                      <div className="flex items-center gap-2 text-green-600">
                        <CheckCircle2 className="h-5 w-5" />
                        <span className="text-sm font-medium">Reporte Enviado</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-amber-600">
                        <AlertCircle className="h-5 w-5" />
                        <span className="text-sm font-medium">Pendiente de Reporte</span>
                      </div>
                    )}
                    
                    <Button asChild size="sm" className="w-full md:w-auto">
                      <Link to={`/staff/standalone/${assignment.id}/cleaning-report`}>
                        {assignment.status === 'completed' ? 'Ver/Editar Reporte' : 'Completar Reporte'}
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
