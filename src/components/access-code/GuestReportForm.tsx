import { useState, useRef } from 'react';
import { useGuestReport } from '@/hooks/useGuestReport';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Upload, CheckCircle2, AlertCircle, X, Camera } from 'lucide-react';

interface MediaFile {
  fieldId: string;
  file: File;
  preview: string;
}

export interface GuestReportFormBooking {
  id: string;
  reservation_number: string;
  full_name: string;
  email: string;
  phone: string | null;
  event_date: string;
}

interface Props {
  booking: GuestReportFormBooking;
  onSubmitted: () => void;
}

const CHECKLIST = [
  { id: 'trash', en: 'All trash is bagged and placed on the back patio. Nothing is left inside.', es: 'Toda la basura está embolsada y colocada en el patio trasero. No queda nada adentro.' },
  { id: 'tables_chairs', en: 'All tables and chairs are broken down and returned to their original placement.', es: 'Todas las mesas y sillas están desmontadas y devueltas a su lugar original.' },
  { id: 'kitchen', en: 'The prep kitchen has been checked.', es: 'La cocina de preparación fue revisada.' },
  { id: 'bathrooms', en: 'Both bathrooms have been checked.', es: 'Ambos baños fueron revisados.' },
  { id: 'personal_items', en: 'All personal items have been removed.', es: 'Todos los artículos personales fueron retirados.' },
  { id: 'equipment', en: 'All remotes and venue equipment have been returned.', es: 'Todos los controles y equipos del venue fueron devueltos.' },
  { id: 'guests_left', en: 'All guests have left the venue.', es: 'Todos los invitados salieron del venue.' },
  { id: 'lights_off', en: 'All lights are turned off.', es: 'Todas las luces están apagadas.' },
  { id: 'door_locked', en: 'The entrance door is locked.', es: 'La puerta de entrada quedó cerrada con llave.' },
] as const;

const REQUIRED_PHOTOS = [
  {
    fieldId: 'guest_main_area_media',
    titleEn: 'Photo 1: Main Venue Space',
    titleEs: 'Foto 1: Espacio Principal del Venue',
    descEn: 'Turn the lights on temporarily and take a clear photo showing the restored main venue space.',
    descEs: 'Enciende las luces temporalmente y toma una foto clara del espacio principal restaurado.',
    uploadLabel: 'Venue main space with lights on',
  },
  {
    fieldId: 'guest_front_door_media',
    titleEn: 'Photo 2: Locked Entrance',
    titleEs: 'Foto 2: Entrada Cerrada con Llave',
    descEn: 'After leaving, lock the entrance and take a clear photo confirming that the venue has been secured.',
    descEs: 'Después de salir, cierra la entrada con llave y toma una foto clara confirmando que el venue quedó asegurado.',
    uploadLabel: 'Entrance door locked',
  },
] as const;

const GuestReportForm = ({ booking, onSubmitted }: Props) => {
  const { submitting, submitReport } = useGuestReport();

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);

  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const handleFileChange = (fieldId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setMediaFiles((prev) => {
      // One photo per field — replace any existing one
      const next = prev.filter((f) => {
        if (f.fieldId === fieldId) {
          URL.revokeObjectURL(f.preview);
          return false;
        }
        return true;
      });
      return [...next, { fieldId, file, preview: URL.createObjectURL(file) }];
    });
  };

  const removeFile = (fieldId: string) => {
    setMediaFiles((prev) => {
      const next = prev.filter((f) => {
        if (f.fieldId === fieldId) {
          URL.revokeObjectURL(f.preview);
          return false;
        }
        return true;
      });
      return next;
    });
  };

  const getFileForField = (fieldId: string) => mediaFiles.find((f) => f.fieldId === fieldId);

  const checklistComplete = CHECKLIST.every((item) => checked[item.id]);
  const photosComplete = REQUIRED_PHOTOS.every((p) => !!getFileForField(p.fieldId));
  const formValid = checklistComplete && photosComplete;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formValid) return;

    const success = await submitReport(
      booking.id,
      booking.reservation_number,
      {
        guest_name: booking.full_name || '',
        guest_email: booking.email || '',
        guest_phone: booking.phone || '',
        guest_confirm_area_clean: !!checked['tables_chairs'],
        guest_confirm_trash_bagged: !!checked['trash'],
        guest_confirm_bathrooms_ok: !!checked['bathrooms'],
        guest_confirm_door_closed: !!checked['door_locked'],
        issue_description: '',
        has_issue: false,
      },
      mediaFiles.map((f) => ({ fieldId: f.fieldId, file: f.file })),
      { rating: 0, comment: '' },
    );

    if (success) onSubmitted();
  };

  return (
    <div className="max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Complete Your Guest Report</CardTitle>
            <p className="text-sm text-muted-foreground">
              Your reservation is not complete until the venue has been restored, locked, and the
              Guest Report has been submitted. Leave enough time to complete every item below before
              your reservation ends.
            </p>
            <p className="text-xs text-muted-foreground italic">
              Tu reservación no está completa hasta que el venue haya sido restaurado, cerrado con
              llave y el Guest Report haya sido enviado.
            </p>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Venue Checklist</CardTitle>
            <p className="text-sm text-muted-foreground">
              Confirm each item in the Guest Report. / Confirma cada punto del reporte.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {CHECKLIST.map((item) => (
              <div key={item.id} className="flex items-start space-x-3">
                <Checkbox
                  id={`check_${item.id}`}
                  checked={!!checked[item.id]}
                  onCheckedChange={(v) => setChecked((prev) => ({ ...prev, [item.id]: v === true }))}
                />
                <label htmlFor={`check_${item.id}`} className="text-sm leading-relaxed cursor-pointer">
                  {item.en}
                  <br />
                  <span className="text-muted-foreground text-xs">{item.es}</span>
                </label>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upload Two Required Photos</CardTitle>
            <p className="text-sm text-muted-foreground">
              Make sure both photos are uploaded before submitting the Guest Report. / Asegúrate de
              subir ambas fotos antes de enviar el reporte.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {REQUIRED_PHOTOS.map((photo) => {
              const file = getFileForField(photo.fieldId);
              return (
                <div key={photo.fieldId} className="space-y-3 p-4 border rounded-lg">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium">{photo.titleEn}</h4>
                      <p className="text-sm text-muted-foreground">{photo.titleEs}</p>
                    </div>
                    {file && <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />}
                  </div>
                  <p className="text-sm text-muted-foreground">{photo.descEn}</p>
                  <p className="text-xs text-muted-foreground italic">{photo.descEs}</p>
                  <div className="flex flex-wrap gap-2">
                    {file ? (
                      <div className="relative w-24 h-24">
                        {file.file.type.startsWith('image/') ? (
                          <img src={file.preview} alt={photo.uploadLabel} className="w-full h-full object-cover rounded" />
                        ) : (
                          <div className="w-full h-full bg-muted rounded flex items-center justify-center">
                            <Camera className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeFile(photo.fieldId)}
                          className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRefs.current[photo.fieldId]?.click()}
                        className="w-full py-6 border-2 border-dashed border-muted-foreground/30 rounded flex flex-col items-center justify-center hover:border-primary/50 transition-colors"
                      >
                        <Upload className="h-5 w-5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground mt-1">
                          Upload: {photo.uploadLabel}
                        </span>
                      </button>
                    )}
                  </div>
                  <input
                    ref={(el) => (fileInputRefs.current[photo.fieldId] = el)}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label={photo.uploadLabel}
                    onChange={(e) => handleFileChange(photo.fieldId, e.target.files)}
                  />
                  {!file && <p className="text-xs text-destructive">This photo is required</p>}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Button type="submit" className="w-full" size="lg" disabled={!formValid || submitting}>
          {submitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting...</>
          ) : (
            'Submit Guest Report / Enviar Reporte'
          )}
        </Button>

        {!formValid && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Complete the checklist and upload both required photos before submitting.<br />
              <span className="text-sm">Completa el checklist y sube las dos fotos requeridas antes de enviar.</span>
            </AlertDescription>
          </Alert>
        )}
      </form>
    </div>
  );
};

export default GuestReportForm;
