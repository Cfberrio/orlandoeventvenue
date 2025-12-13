import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useGuestReport } from '@/hooks/useGuestReport';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Upload, CheckCircle2, AlertCircle, Camera, X, Star } from 'lucide-react';
import { format } from 'date-fns';

interface MediaFile {
  fieldId: string;
  file: File;
  preview: string;
}

const GuestReport = () => {
  const { reservationNumber } = useParams<{ reservationNumber: string }>();
  const [searchParams] = useSearchParams();
  const code = reservationNumber || searchParams.get('code') || '';

  const { loading, submitting, lookupBooking, submitReport } = useGuestReport();

  const [booking, setBooking] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Form state
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  // Media uploads
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);

  // Confirmations
  const [confirmAreaClean, setConfirmAreaClean] = useState(false);
  const [confirmTrashBagged, setConfirmTrashBagged] = useState(false);
  const [confirmBathroomsOk, setConfirmBathroomsOk] = useState(false);
  const [confirmDoorClosed, setConfirmDoorClosed] = useState(false);

  // Issue report
  const [issueDescription, setIssueDescription] = useState('');

  // Review
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');

  // File input refs
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  useEffect(() => {
    const fetchBooking = async () => {
      if (!code) {
        setNotFound(true);
        return;
      }

      const data = await lookupBooking(code);
      if (data) {
        setBooking(data);
        setGuestName(data.full_name || '');
        setGuestEmail(data.email || '');
        setGuestPhone(data.phone || '');
      } else {
        setNotFound(true);
      }
    };

    fetchBooking();
  }, [code]);

  const handleFileChange = (fieldId: string, files: FileList | null) => {
    if (!files) return;

    const newFiles: MediaFile[] = Array.from(files).map((file) => ({
      fieldId,
      file,
      preview: URL.createObjectURL(file),
    }));

    setMediaFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setMediaFiles((prev) => {
      const newFiles = [...prev];
      URL.revokeObjectURL(newFiles[index].preview);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const getFilesForField = (fieldId: string) => {
    return mediaFiles.filter((f) => f.fieldId === fieldId);
  };

  const validateForm = () => {
    // Check required media uploads
    const requiredFields = [
      { id: 'guest_front_door_media', min: 1 },
      { id: 'guest_main_area_media', min: 1 },
      { id: 'guest_rack_media', min: 1 },
      { id: 'guest_bathrooms_media', min: 2 },
      { id: 'guest_kitchen_trash_media', min: 1 },
    ];

    for (const field of requiredFields) {
      if (getFilesForField(field.id).length < field.min) {
        return false;
      }
    }

    // Check confirmations
    if (!confirmAreaClean || !confirmTrashBagged || !confirmBathroomsOk || !confirmDoorClosed) {
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!booking || !validateForm()) return;

    const hasIssue = issueDescription.trim().length > 0 || getFilesForField('guest_issue_media').length > 0;

    const success = await submitReport(
      booking.id,
      booking.reservation_number,
      {
        guest_name: guestName,
        guest_email: guestEmail,
        guest_phone: guestPhone,
        guest_confirm_area_clean: confirmAreaClean,
        guest_confirm_trash_bagged: confirmTrashBagged,
        guest_confirm_bathrooms_ok: confirmBathroomsOk,
        guest_confirm_door_closed: confirmDoorClosed,
        issue_description: issueDescription,
        has_issue: hasIssue,
      },
      mediaFiles.map((f) => ({ fieldId: f.fieldId, file: f.file })),
      reviewRating > 0 ? { rating: reviewRating, comment: reviewComment } : undefined
    );

    if (success) {
      setSubmitted(true);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Reservation Not Found</h2>
            <p className="text-muted-foreground mb-4">
              We couldn't find this reservation. Please contact our team.
            </p>
            <p className="text-muted-foreground text-sm">
              No pudimos encontrar esta reservación. Por favor contacta a nuestro equipo.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Report Submitted!</h2>
            <p className="text-muted-foreground mb-4">
              Thank you for submitting your post-event report. Our team will review it shortly.
            </p>
            <p className="text-muted-foreground text-sm">
              ¡Gracias por enviar tu reporte post-evento! Nuestro equipo lo revisará pronto.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const MediaUploadSection = ({
    fieldId,
    titleEn,
    titleEs,
    descEn,
    descEs,
    minFiles,
    maxFiles,
  }: {
    fieldId: string;
    titleEn: string;
    titleEs: string;
    descEn: string;
    descEs: string;
    minFiles: number;
    maxFiles: number;
  }) => {
    const files = getFilesForField(fieldId);
    const isValid = files.length >= minFiles;

    return (
      <div className="space-y-3 p-4 border rounded-lg">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-medium">{titleEn}</h4>
            <p className="text-sm text-muted-foreground">{titleEs}</p>
          </div>
          {isValid && <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />}
        </div>
        <p className="text-sm text-muted-foreground">{descEn}</p>
        <p className="text-xs text-muted-foreground italic">{descEs}</p>

        <div className="flex flex-wrap gap-2">
          {files.map((f, idx) => (
            <div key={idx} className="relative w-20 h-20">
              {f.file.type.startsWith('image/') ? (
                <img src={f.preview} alt="" className="w-full h-full object-cover rounded" />
              ) : (
                <div className="w-full h-full bg-muted rounded flex items-center justify-center">
                  <Camera className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <button
                type="button"
                onClick={() => removeFile(mediaFiles.indexOf(f))}
                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}

          {files.length < maxFiles && (
            <button
              type="button"
              onClick={() => fileInputRefs.current[fieldId]?.click()}
              className="w-20 h-20 border-2 border-dashed border-muted-foreground/30 rounded flex flex-col items-center justify-center hover:border-primary/50 transition-colors"
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground mt-1">Add</span>
            </button>
          )}
        </div>

        <input
          ref={(el) => (fileInputRefs.current[fieldId] = el)}
          type="file"
          accept="image/*,video/*"
          multiple={maxFiles > 1}
          className="hidden"
          onChange={(e) => handleFileChange(fieldId, e.target.files)}
        />

        {!isValid && (
          <p className="text-xs text-destructive">
            {minFiles === 1 ? 'At least 1 file required' : `At least ${minFiles} files required`}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Card className="mb-6">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Post-Event Report / Reporte Post-Evento</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Confirmation Code / Código</p>
                <p className="font-semibold">{booking?.reservation_number}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Event Date / Fecha</p>
                <p className="font-semibold">
                  {booking?.event_date ? format(new Date(booking.event_date), 'MMM d, yyyy') : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Guest Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your Information / Tu Información</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="guest_name">Your Name / Tu Nombre</Label>
                <Input
                  id="guest_name"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guest_email">Email</Label>
                <Input
                  id="guest_email"
                  type="email"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guest_phone">Phone / Teléfono</Label>
                <Input
                  id="guest_phone"
                  type="tel"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  required
                />
              </div>
            </CardContent>
          </Card>

          {/* Media Uploads */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Photos & Videos / Fotos y Videos</CardTitle>
              <p className="text-sm text-muted-foreground">
                Please upload photos or videos of each area. / Por favor sube fotos o videos de cada área.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <MediaUploadSection
                fieldId="guest_front_door_media"
                titleEn="1. Front Door Closed"
                titleEs="Puerta Principal Cerrada"
                descEn="Upload a clear photo or short video of the front door fully closed."
                descEs="Sube una foto o video corto de la puerta principal completamente cerrada."
                minFiles={1}
                maxFiles={1}
              />

              <MediaUploadSection
                fieldId="guest_main_area_media"
                titleEn="2. Main Event Area"
                titleEs="Área Principal del Evento"
                descEn="Show the stage and screen. All tables and chairs must be picked up and cleared."
                descEs="Muestra la tarima y la pantalla. Todas las mesas y sillas deben estar recogidas."
                minFiles={1}
                maxFiles={3}
              />

              <MediaUploadSection
                fieldId="guest_rack_media"
                titleEn="3. Tables & Chairs on Rack"
                titleEs="Mesas y Sillas en el Rack"
                descEn="Show tables and chairs properly organized on the rack."
                descEs="Muestra las mesas y sillas organizadas correctamente en el rack."
                minFiles={1}
                maxFiles={3}
              />

              <MediaUploadSection
                fieldId="guest_bathrooms_media"
                titleEn="4. Bathrooms (Both)"
                titleEs="Baños (Ambos)"
                descEn="Show both bathrooms clean and picked up."
                descEs="Muestra ambos baños limpios y ordenados."
                minFiles={2}
                maxFiles={4}
              />

              <MediaUploadSection
                fieldId="guest_kitchen_trash_media"
                titleEn="5. Kitchen – Trash Gathered"
                titleEs="Cocina – Basura Reunida"
                descEn="Show all trash bags in the kitchen gathered and tied."
                descEs="Muestra todas las bolsas de basura en la cocina reunidas y amarradas."
                minFiles={1}
                maxFiles={3}
              />
            </CardContent>
          </Card>

          {/* Confirmations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Confirmations / Confirmaciones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="confirm_area"
                  checked={confirmAreaClean}
                  onCheckedChange={(v) => setConfirmAreaClean(v === true)}
                />
                <Label htmlFor="confirm_area" className="text-sm leading-relaxed cursor-pointer">
                  I confirm the main event area is clean and all tables and chairs are picked up.
                  <br />
                  <span className="text-muted-foreground">
                    Confirmo que el área principal está limpia y todas las mesas y sillas están recogidas.
                  </span>
                </Label>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="confirm_trash"
                  checked={confirmTrashBagged}
                  onCheckedChange={(v) => setConfirmTrashBagged(v === true)}
                />
                <Label htmlFor="confirm_trash" className="text-sm leading-relaxed cursor-pointer">
                  I confirm all trash is bagged and placed in the kitchen.
                  <br />
                  <span className="text-muted-foreground">
                    Confirmo que toda la basura está embolsada y colocada en la cocina.
                  </span>
                </Label>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="confirm_bathrooms"
                  checked={confirmBathroomsOk}
                  onCheckedChange={(v) => setConfirmBathroomsOk(v === true)}
                />
                <Label htmlFor="confirm_bathrooms" className="text-sm leading-relaxed cursor-pointer">
                  I confirm both bathrooms are left in acceptable condition.
                  <br />
                  <span className="text-muted-foreground">
                    Confirmo que ambos baños quedaron en condiciones aceptables.
                  </span>
                </Label>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="confirm_door"
                  checked={confirmDoorClosed}
                  onCheckedChange={(v) => setConfirmDoorClosed(v === true)}
                />
                <Label htmlFor="confirm_door" className="text-sm leading-relaxed cursor-pointer">
                  I confirm the front door is properly closed upon leaving.
                  <br />
                  <span className="text-muted-foreground">
                    Confirmo que la puerta principal quedó cerrada al salir.
                  </span>
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Issue Report */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Issue Report (Optional) / Reporte de Problemas (Opcional)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="issue_description">
                  Describe any issue, damage, or problem / Describe cualquier problema o daño
                </Label>
                <Textarea
                  id="issue_description"
                  value={issueDescription}
                  onChange={(e) => setIssueDescription(e.target.value)}
                  placeholder="Optional - Describe any issues you'd like us to review..."
                  rows={4}
                />
              </div>

              <MediaUploadSection
                fieldId="guest_issue_media"
                titleEn="Issue Photos/Videos"
                titleEs="Fotos/Videos del Problema"
                descEn="If reporting an issue, upload any photos or videos that help us understand it."
                descEs="Si estás reportando un problema, sube fotos o videos que nos ayuden a entenderlo."
                minFiles={0}
                maxFiles={5}
              />
            </CardContent>
          </Card>

          {/* Review Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Leave a Review (Optional) / Deja una Reseña (Opcional)</CardTitle>
              <p className="text-sm text-muted-foreground">
                How was your experience? / ¿Cómo fue tu experiencia?
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Rating / Calificación</Label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setReviewRating(star)}
                      className="p-1 hover:scale-110 transition-transform"
                    >
                      <Star
                        className={`h-8 w-8 ${
                          star <= reviewRating
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-muted-foreground/30'
                        }`}
                      />
                    </button>
                  ))}
                </div>
                {reviewRating > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {reviewRating === 5 && 'Excellent! / ¡Excelente!'}
                    {reviewRating === 4 && 'Very Good / Muy Bueno'}
                    {reviewRating === 3 && 'Good / Bueno'}
                    {reviewRating === 2 && 'Fair / Regular'}
                    {reviewRating === 1 && 'Poor / Malo'}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="review_comment">
                  Comments / Comentarios
                </Label>
                <Textarea
                  id="review_comment"
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Share your experience with us... / Comparte tu experiencia con nosotros..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Submit */}
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={!validateForm() || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              'Submit Report / Enviar Reporte'
            )}
          </Button>

          {!validateForm() && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Please complete all required fields and upload all required photos before submitting.
                <br />
                <span className="text-sm">
                  Por favor completa todos los campos requeridos y sube todas las fotos requeridas antes de enviar.
                </span>
              </AlertDescription>
            </Alert>
          )}
        </form>
      </div>
    </div>
  );
};

export default GuestReport;
