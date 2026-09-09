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
  { id: 'trash', label: 'All trash is bagged and placed on the back patio. Nothing is left inside.' },
  { id: 'tables_chairs', label: 'All tables and chairs are broken down and returned to their original placement.' },
  { id: 'kitchen', label: 'The prep kitchen has been checked.' },
  { id: 'bathrooms', label: 'Both bathrooms have been checked.' },
  { id: 'personal_items', label: 'All personal items have been removed.' },
  { id: 'equipment', label: 'All remotes and venue equipment have been returned.' },
  { id: 'guests_left', label: 'All guests have left the venue.' },
  { id: 'lights_off', label: 'All lights are turned off.' },
  { id: 'door_locked', label: 'The entrance door is locked.' },
] as const;

const REQUIRED_PHOTOS = [
  {
    fieldId: 'guest_main_area_media',
    title: 'Photo 1: Main Venue Space',
    desc: 'Turn the lights on temporarily and take a clear photo showing the restored main venue space.',
    uploadLabel: 'Venue main space with lights on',
  },
  {
    fieldId: 'guest_front_door_media',
    title: 'Photo 2: Locked Entrance',
    desc: 'After leaving, lock the entrance and take a clear photo confirming that the venue has been secured.',
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
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Venue Checklist</CardTitle>
            <p className="text-sm text-muted-foreground">
              Confirm each item in the Guest Report.
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
                  {item.label}
                </label>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upload Two Required Photos</CardTitle>
            <p className="text-sm text-muted-foreground">
              Make sure both photos are uploaded before submitting the Guest Report.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {REQUIRED_PHOTOS.map((photo) => {
              const file = getFileForField(photo.fieldId);
              return (
                <div key={photo.fieldId} className="space-y-3 p-4 border rounded-lg">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium">{photo.title}</h4>
                    </div>
                    {file && <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />}
                  </div>
                  <p className="text-sm text-muted-foreground">{photo.desc}</p>
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
            'Submit Guest Report'
          )}
        </Button>

        {!formValid && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Complete the checklist and upload both required photos before submitting.
            </AlertDescription>
          </Alert>
        )}
      </form>
    </div>
  );
};

export default GuestReportForm;
