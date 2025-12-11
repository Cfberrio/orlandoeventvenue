import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Upload, X, Plus, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useStaffSession } from "@/hooks/useStaffSession";
import {
  useStaffBookingDetail,
  useBookingCleaningReport,
  useUpdateCleaningReport,
  useCreateMaintenanceTicket,
  uploadCleaningMedia,
} from "@/hooks/useStaffData";

interface InventoryItem {
  item_name: string;
  status: "stocked" | "low" | "out";
  qty_estimate: string;
}

const defaultInventoryItems: InventoryItem[] = [
  { item_name: "Trash Bags", status: "stocked", qty_estimate: "" },
  { item_name: "Paper Towels", status: "stocked", qty_estimate: "" },
  { item_name: "Toilet Paper", status: "stocked", qty_estimate: "" },
  { item_name: "Hand Soap", status: "stocked", qty_estimate: "" },
  { item_name: "Cleaning Spray", status: "stocked", qty_estimate: "" },
];

export default function CleaningReportForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const { data: booking, isLoading: bookingLoading } = useStaffBookingDetail(id || "");
  const { data: existingReport, isLoading: reportLoading } = useBookingCleaningReport(id || "");
  const { staffMember } = useStaffSession();
  const updateReport = useUpdateCleaningReport();
  const createTicket = useCreateMaintenanceTicket();

  // Form state
  const [cleanerName, setCleanerName] = useState("");
  const [cleanerRole, setCleanerRole] = useState("");
  const [issuesNotes, setIssuesNotes] = useState("");
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>(defaultInventoryItems);
  
  // Media uploads state
  const [mediaFrontDoor, setMediaFrontDoor] = useState<string[]>([]);
  const [mediaMainArea, setMediaMainArea] = useState<string[]>([]);
  const [mediaRack, setMediaRack] = useState<string[]>([]);
  const [mediaBathrooms, setMediaBathrooms] = useState<string[]>([]);
  const [mediaKitchen, setMediaKitchen] = useState<string[]>([]);
  const [mediaDeepCleaning, setMediaDeepCleaning] = useState<string[]>([]);
  
  // Checklist state
  const [checkFloors, setCheckFloors] = useState(false);
  const [checkBathrooms, setCheckBathrooms] = useState(false);
  const [checkKitchen, setCheckKitchen] = useState(false);
  const [checkTrashRemoved, setCheckTrashRemoved] = useState(false);
  const [checkEquipmentStored, setCheckEquipmentStored] = useState(false);
  const [checkTablesChairs, setCheckTablesChairs] = useState(false);
  const [checkLightsOff, setCheckLightsOff] = useState(false);
  const [checkOfficeDoor, setCheckOfficeDoor] = useState(false);
  const [checkDoorLocked, setCheckDoorLocked] = useState(false);
  const [checkDeepCleaning, setCheckDeepCleaning] = useState(false);

  const [uploading, setUploading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load existing data
  useEffect(() => {
    if (staffMember) {
      setCleanerName(existingReport?.cleaner_name || staffMember.full_name || "");
      setCleanerRole(existingReport?.cleaner_role || staffMember.role || "");
    }
    
    if (existingReport) {
      setIssuesNotes(existingReport.clean_issues_notes || "");
      setInventoryItems((existingReport.inventory_items as InventoryItem[])?.length > 0 
        ? existingReport.inventory_items as InventoryItem[]
        : defaultInventoryItems);
      setMediaFrontDoor(existingReport.media_front_door as string[] || []);
      setMediaMainArea(existingReport.media_main_area as string[] || []);
      setMediaRack(existingReport.media_rack as string[] || []);
      setMediaBathrooms(existingReport.media_bathrooms as string[] || []);
      setMediaKitchen(existingReport.media_kitchen as string[] || []);
      setMediaDeepCleaning(existingReport.media_deep_cleaning as string[] || []);
      setCheckFloors(existingReport.clean_check_floors || false);
      setCheckBathrooms(existingReport.clean_check_bathrooms || false);
      setCheckKitchen(existingReport.clean_check_kitchen || false);
      setCheckTrashRemoved(existingReport.clean_check_trash_removed || false);
      setCheckEquipmentStored(existingReport.clean_check_equipment_stored || false);
      setCheckTablesChairs(existingReport.clean_check_tables_chairs_positioned || false);
      setCheckLightsOff(existingReport.clean_check_lights_off || false);
      setCheckOfficeDoor(existingReport.clean_check_office_door_closed || false);
      setCheckDoorLocked(existingReport.clean_check_door_locked || false);
      setCheckDeepCleaning(existingReport.clean_check_deep_cleaning_done || false);
    }
  }, [existingReport, staffMember]);

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    fieldId: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    maxFiles: number
  ) => {
    const files = e.target.files;
    if (!files || !id) return;
    
    setUploading(fieldId);
    try {
      const urls: string[] = [];
      for (let i = 0; i < Math.min(files.length, maxFiles); i++) {
        const url = await uploadCleaningMedia(files[i], id, fieldId);
        urls.push(url);
      }
      setter(prev => [...prev, ...urls].slice(0, maxFiles));
      toast({ title: "Files uploaded successfully" });
    } catch (error) {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(null);
    }
  };

  const removeMedia = (setter: React.Dispatch<React.SetStateAction<string[]>>, index: number) => {
    setter(prev => prev.filter((_, i) => i !== index));
  };

  const updateInventoryItem = (index: number, field: keyof InventoryItem, value: string) => {
    setInventoryItems(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const addInventoryItem = () => {
    setInventoryItems(prev => [...prev, { item_name: "", status: "stocked", qty_estimate: "" }]);
  };

  const removeInventoryItem = (index: number) => {
    setInventoryItems(prev => prev.filter((_, i) => i !== index));
  };

  const validateForm = (): string | null => {
    if (mediaFrontDoor.length === 0) return "Front door media is required";
    if (mediaMainArea.length === 0) return "Main area media is required";
    if (mediaRack.length === 0) return "Tables & chairs rack media is required";
    if (mediaBathrooms.length < 2) return "At least 2 bathroom photos are required";
    if (mediaKitchen.length === 0) return "Kitchen media is required";
    if (checkDeepCleaning && mediaDeepCleaning.length === 0) {
      return "Deep cleaning media is required when deep cleaning checkbox is checked";
    }
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validateForm();
    if (validationError) {
      toast({ title: validationError, variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const inventoryNeedsUpdate = inventoryItems.some(item => 
        item.status === "low" || item.status === "out"
      );

      await updateReport.mutateAsync({
        bookingId: id!,
        reportData: {
          status: "completed",
          cleaner_name: cleanerName,
          cleaner_role: cleanerRole,
          clean_issues_notes: issuesNotes,
          inventory_update_needed: inventoryNeedsUpdate,
          inventory_items: inventoryItems as any,
          media_front_door: mediaFrontDoor as any,
          media_main_area: mediaMainArea as any,
          media_rack: mediaRack as any,
          media_bathrooms: mediaBathrooms as any,
          media_kitchen: mediaKitchen as any,
          media_deep_cleaning: mediaDeepCleaning as any,
          clean_check_floors: checkFloors,
          clean_check_bathrooms: checkBathrooms,
          clean_check_kitchen: checkKitchen,
          clean_check_trash_removed: checkTrashRemoved,
          clean_check_equipment_stored: checkEquipmentStored,
          clean_check_tables_chairs_positioned: checkTablesChairs,
          clean_check_lights_off: checkLightsOff,
          clean_check_office_door_closed: checkOfficeDoor,
          clean_check_door_locked: checkDoorLocked,
          clean_check_deep_cleaning_done: checkDeepCleaning,
          completed_at: new Date().toISOString(),
        },
      });

      // Create maintenance ticket if there are issues
      if (issuesNotes.trim()) {
        await createTicket.mutateAsync({
          booking_id: id!,
          title: `Issue from cleaning report for booking ${booking?.reservation_number || id}`,
          description: issuesNotes,
          reported_by_role: "cleaner",
          priority: "medium",
        });
      }

      // Sync to GHL
      await supabase.functions.invoke("sync-to-ghl", {
        body: { booking_id: id },
      });

      toast({ title: "Cleaning report submitted successfully" });
      navigate(`/staff/bookings/${id}`);
    } catch (error) {
      toast({ title: "Failed to submit report", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (bookingLoading || reportLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="space-y-6">
        <Link to="/staff" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Link>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Booking not found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Link 
        to={`/staff/bookings/${id}`} 
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Booking
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Cleaning Report</h1>
        <p className="text-muted-foreground">{booking.reservation_number}</p>
      </div>

      {/* Instructions */}
      <Card className="bg-muted/50">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            <strong>EN:</strong> Who fills it: Assigned cleaning staff. When: After the event. 
            The staff member will upload this report to the specific reservation they are assigned to.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            <strong>ES:</strong> Quién lo llena: Personal de limpieza asignado. Cuándo: Después del evento. 
            El miembro del staff subirá este reporte a la reservación específica a la que fue asignado.
          </p>
        </CardContent>
      </Card>

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Staff Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cleanerName">Cleaner Name</Label>
              <Input
                id="cleanerName"
                value={cleanerName}
                onChange={(e) => setCleanerName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cleanerRole">Role</Label>
              <Input
                id="cleanerRole"
                value={cleanerRole}
                onChange={(e) => setCleanerRole(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Media Uploads */}
      <MediaUploadSection
        title="Front Door Closed & Locked"
        descriptionEN="Show the front door closed. The angle must clearly indicate it's locked (deadbolt/bar if visible)."
        descriptionES="Muestra la puerta principal cerrada. El ángulo debe indicar claramente que está asegurada (cerrojo/barra visible si aplica)."
        fieldId="front_door"
        files={mediaFrontDoor}
        maxFiles={1}
        uploading={uploading}
        onUpload={(e) => handleFileUpload(e, "front_door", setMediaFrontDoor, 1)}
        onRemove={(i) => removeMedia(setMediaFrontDoor, i)}
        required
      />

      <MediaUploadSection
        title="Main Event Area – Stage, Screen, All Cleared"
        descriptionEN="Show the stage and screen. Show the entire main area clean, with no trash, no items on tables, and the floor clean."
        descriptionES="Muestra la tarima y la pantalla. Muestra toda el área principal limpia, sin basura, sin objetos sobre las mesas y el piso limpio."
        fieldId="main_area"
        files={mediaMainArea}
        maxFiles={3}
        uploading={uploading}
        onUpload={(e) => handleFileUpload(e, "main_area", setMediaMainArea, 3)}
        onRemove={(i) => removeMedia(setMediaMainArea, i)}
        required
      />

      <MediaUploadSection
        title="Tables & Chairs on the Rack"
        descriptionEN="Show tables and chairs properly stacked on the rack. Include the rack space area clean."
        descriptionES="Muestra las mesas y sillas correctamente apiladas en el rack. Incluye el espacio del rack limpio."
        fieldId="rack"
        files={mediaRack}
        maxFiles={3}
        uploading={uploading}
        onUpload={(e) => handleFileUpload(e, "rack", setMediaRack, 3)}
        onRemove={(i) => removeMedia(setMediaRack, i)}
        required
      />

      <MediaUploadSection
        title="Bathrooms (Both) – After Cleaning"
        descriptionEN="Show both bathrooms clean. Show floor, toilet, sink areas clearly."
        descriptionES="Muestra ambos baños limpios. Muestra claramente el piso, el inodoro y el lavamanos."
        fieldId="bathrooms"
        files={mediaBathrooms}
        maxFiles={4}
        uploading={uploading}
        onUpload={(e) => handleFileUpload(e, "bathrooms", setMediaBathrooms, 4)}
        onRemove={(i) => removeMedia(setMediaBathrooms, i)}
        required
        minRequired={2}
      />

      <MediaUploadSection
        title="Kitchen – Trash Removed + Cans Set Up"
        descriptionEN="All trash bags must be gone from the kitchen and event areas. Show the two trash cans with: Current bag installed, One extra bag folded under the current bag."
        descriptionES="Todas las bolsas de basura deben estar retiradas. Muestra los dos zafacones con: La bolsa actual instalada, Una bolsa extra doblada debajo."
        fieldId="kitchen"
        files={mediaKitchen}
        maxFiles={3}
        uploading={uploading}
        onUpload={(e) => handleFileUpload(e, "kitchen", setMediaKitchen, 3)}
        onRemove={(i) => removeMedia(setMediaKitchen, i)}
        required
      />

      <MediaUploadSection
        title="Deep Cleaning (Only if applicable)"
        descriptionEN="If deep cleaning was performed, upload additional images of: Frames / wall decor cleaned, Chair rack space cleaned, Table storage clean, Any special detailed areas cleaned"
        descriptionES="Si hubo limpieza profunda, sube imágenes de: Cuadros / decoración limpia, Espacio del rack de sillas limpio, Almacén de mesas limpio, Áreas detalladas adicionales"
        fieldId="deep_cleaning"
        files={mediaDeepCleaning}
        maxFiles={6}
        uploading={uploading}
        onUpload={(e) => handleFileUpload(e, "deep_cleaning", setMediaDeepCleaning, 6)}
        onRemove={(i) => removeMedia(setMediaDeepCleaning, i)}
        required={checkDeepCleaning}
      />

      {/* Checklist */}
      <Card>
        <CardHeader>
          <CardTitle>Cleaning Checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChecklistItem
            checked={checkFloors}
            onCheckedChange={setCheckFloors}
            labelEN="Floors swept and/or mopped in all used areas."
            labelES="Pisos barridos y/o trapeados en todas las áreas utilizadas."
          />
          <ChecklistItem
            checked={checkBathrooms}
            onCheckedChange={setCheckBathrooms}
            labelEN="Bathrooms cleaned (toilets, sinks, mirrors, floor)."
            labelES="Baños limpiados (inodoros, lavamanos, espejos, piso)."
          />
          <ChecklistItem
            checked={checkKitchen}
            onCheckedChange={setCheckKitchen}
            labelEN="Kitchen surfaces and main working areas cleaned."
            labelES="Superficies de cocina y áreas principales de trabajo limpias."
          />
          <ChecklistItem
            checked={checkTrashRemoved}
            onCheckedChange={setCheckTrashRemoved}
            labelEN="All trash bags removed and disposed in the correct location."
            labelES="Todas las bolsas de basura retiradas y llevadas al lugar correcto."
          />
          <ChecklistItem
            checked={checkEquipmentStored}
            onCheckedChange={setCheckEquipmentStored}
            labelEN="All venue equipment is stored safely in its correct storage location."
            labelES="Todo el equipo del venue está guardado de forma segura en su ubicación correcta."
          />
          <ChecklistItem
            checked={checkTablesChairs}
            onCheckedChange={setCheckTablesChairs}
            labelEN="All chairs and tables are placed in their correct designated locations."
            labelES="Todas las mesas y sillas están colocadas en sus ubicaciones designadas correctas."
          />
          <ChecklistItem
            checked={checkLightsOff}
            onCheckedChange={setCheckLightsOff}
            labelEN="All lights are turned off."
            labelES="Todas las luces están apagadas."
          />
          <ChecklistItem
            checked={checkOfficeDoor}
            onCheckedChange={setCheckOfficeDoor}
            labelEN="Office door is fully closed after cleaning is finalized."
            labelES="La puerta de la oficina está completamente cerrada después de finalizar la limpieza."
          />
          <ChecklistItem
            checked={checkDoorLocked}
            onCheckedChange={setCheckDoorLocked}
            labelEN="Front door is locked and secured."
            labelES="La puerta principal está cerrada con llave y asegurada."
          />
          <ChecklistItem
            checked={checkDeepCleaning}
            onCheckedChange={setCheckDeepCleaning}
            labelEN="Deep cleaning performed for this event."
            labelES="Se realizó limpieza profunda para este evento."
          />
        </CardContent>
      </Card>

      {/* Inventory Check */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory Check</CardTitle>
          <CardDescription>
            Check the status of supplies. Items marked as "low" or "out" will trigger a restock notification.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {inventoryItems.map((item, index) => (
            <div key={index} className="flex items-center gap-3">
              <Input
                placeholder="Item name"
                value={item.item_name}
                onChange={(e) => updateInventoryItem(index, "item_name", e.target.value)}
                className="flex-1"
              />
              <Select
                value={item.status}
                onValueChange={(value) => updateInventoryItem(index, "status", value)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stocked">Stocked</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="out">Out</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Qty"
                value={item.qty_estimate}
                onChange={(e) => updateInventoryItem(index, "qty_estimate", e.target.value)}
                className="w-20"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeInventoryItem(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addInventoryItem}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </CardContent>
      </Card>

      {/* Notes / Maintenance */}
      <Card>
        <CardHeader>
          <CardTitle>Notes / Maintenance Issues</CardTitle>
          <CardDescription>
            EN: Maintenance issues, damages, or anything that needs follow-up.
            <br />
            ES: Problemas de mantenimiento, daños o cualquier cosa que requiera seguimiento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={issuesNotes}
            onChange={(e) => setIssuesNotes(e.target.value)}
            placeholder="Describe any issues found..."
            rows={4}
          />
          {issuesNotes.trim() && (
            <p className="text-sm text-muted-foreground mt-2">
              ⚠️ A maintenance ticket will be created automatically when you submit this report.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex justify-end gap-4">
        <Button variant="outline" asChild>
          <Link to={`/staff/bookings/${id}`}>Cancel</Link>
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Submit Report
        </Button>
      </div>
    </div>
  );
}

// Media Upload Section Component
function MediaUploadSection({
  title,
  descriptionEN,
  descriptionES,
  fieldId,
  files,
  maxFiles,
  uploading,
  onUpload,
  onRemove,
  required,
  minRequired,
}: {
  title: string;
  descriptionEN: string;
  descriptionES: string;
  fieldId: string;
  files: string[];
  maxFiles: number;
  uploading: string | null;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  required?: boolean;
  minRequired?: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {title}
          {required && <span className="text-destructive">*</span>}
        </CardTitle>
        <CardDescription>
          <span className="block"><strong>EN:</strong> {descriptionEN}</span>
          <span className="block mt-1"><strong>ES:</strong> {descriptionES}</span>
          {minRequired && (
            <span className="block mt-1 text-xs">Minimum {minRequired} file(s) required</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          {files.map((url, index) => (
            <div key={index} className="relative group">
              <img
                src={url}
                alt={`${fieldId} ${index + 1}`}
                className="h-24 w-24 object-cover rounded-md border border-border"
              />
              <button
                onClick={() => onRemove(index)}
                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {files.length < maxFiles && (
            <label className="h-24 w-24 border-2 border-dashed border-border rounded-md flex items-center justify-center cursor-pointer hover:border-primary transition-colors">
              {uploading === fieldId ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                <Upload className="h-6 w-6 text-muted-foreground" />
              )}
              <input
                type="file"
                accept="image/*,video/*"
                multiple={maxFiles > 1}
                onChange={onUpload}
                className="hidden"
                disabled={uploading !== null}
              />
            </label>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Checklist Item Component
function ChecklistItem({
  checked,
  onCheckedChange,
  labelEN,
  labelES,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  labelEN: string;
  labelES: string;
}) {
  return (
    <div className="flex items-start space-x-3">
      <Checkbox
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mt-1"
      />
      <div className="space-y-1">
        <p className="text-sm">{labelEN}</p>
        <p className="text-xs text-muted-foreground">{labelES}</p>
      </div>
    </div>
  );
}
