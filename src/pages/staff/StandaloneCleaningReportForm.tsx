import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Upload, X, Loader2, ClipboardCheck, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useStaffSession } from "@/hooks/useStaffSession";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useStandaloneAssignment,
  useStandaloneCleaningReport,
  useUpdateStandaloneCleaningReport,
  uploadStandaloneCleaningMedia,
  type StandaloneCleaningReport,
} from "@/hooks/useStandaloneCleaningData";
import { format } from "date-fns";

export default function StandaloneCleaningReportForm() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const { data: assignment, isLoading: assignmentLoading } = useStandaloneAssignment(assignmentId || "");
  const { data: existingReport, isLoading: reportLoading } = useStandaloneCleaningReport(assignmentId || "");
  const { staffMember } = useStaffSession();
  const updateReport = useUpdateStandaloneCleaningReport();
  
  // Block access for Production and Assistant roles
  if (staffMember?.role === 'Production' || staffMember?.role === 'Assistant') {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardCheck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Access Restricted</h3>
            <p className="text-muted-foreground mb-4">
              Cleaning reports are not available for your role ({staffMember.role}).
            </p>
            <Button asChild>
              <Link to="/staff/standalone">Back to My Assignments</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Form state
  const [cleanerName, setCleanerName] = useState("");
  const [cleanerRole, setCleanerRole] = useState("");
  const [issuesFound, setIssuesFound] = useState(false);
  const [issuesNotes, setIssuesNotes] = useState("");
  const [damageFound, setDamageFound] = useState(false);
  const [damageDescription, setDamageDescription] = useState("");
  const [inventoryUpdateNeeded, setInventoryUpdateNeeded] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<Array<{ name: string; quantity: number }>>([]);
  
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
  const [checkFrontDoor, setCheckFrontDoor] = useState(false);
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
      setIssuesFound(existingReport.issues_found);
      setIssuesNotes(existingReport.issues_notes || "");
      setDamageFound(existingReport.damage_found);
      setDamageDescription(existingReport.damage_description || "");
      setInventoryUpdateNeeded(existingReport.inventory_update_needed);
      setInventoryItems(existingReport.inventory_items || []);
      
      setMediaFrontDoor(existingReport.media_front_door || []);
      setMediaMainArea(existingReport.media_main_area || []);
      setMediaRack(existingReport.media_rack || []);
      setMediaBathrooms(existingReport.media_bathrooms || []);
      setMediaKitchen(existingReport.media_kitchen || []);
      setMediaDeepCleaning(existingReport.media_deep_cleaning || []);
      
      setCheckFloors(existingReport.clean_check_floors_swept_mopped);
      setCheckBathrooms(existingReport.clean_check_bathrooms_cleaned);
      setCheckKitchen(existingReport.clean_check_kitchen_cleaned);
      setCheckTrashRemoved(existingReport.clean_check_trash_removed);
      setCheckEquipmentStored(existingReport.clean_check_equipment_stored);
      setCheckTablesChairs(existingReport.clean_check_tables_chairs_arranged);
      setCheckLightsOff(existingReport.clean_check_lights_off);
      setCheckOfficeDoor(existingReport.clean_check_office_door_locked);
      setCheckFrontDoor(existingReport.clean_check_front_door_locked);
      setCheckDeepCleaning(existingReport.clean_check_deep_cleaning_done);
    }
  }, [existingReport, staffMember]);

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    category: 'front_door' | 'main_area' | 'rack' | 'bathrooms' | 'kitchen' | 'deep_cleaning',
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    maxFiles: number
  ) => {
    const files = e.target.files;
    if (!files || !assignmentId) return;
    
    setUploading(category);
    try {
      const urls: string[] = [];
      for (let i = 0; i < Math.min(files.length, maxFiles); i++) {
        const url = await uploadStandaloneCleaningMedia(assignmentId, files[i], category);
        urls.push(url);
      }
      setter(prev => [...prev, ...urls].slice(0, maxFiles));
      toast({ title: "Files uploaded successfully" });
    } catch (error) {
      console.error("Upload error:", error);
      toast({ title: "Error uploading files", variant: "destructive" });
    } finally {
      setUploading(null);
    }
  };

  const removeMedia = (setter: React.Dispatch<React.SetStateAction<string[]>>, index: number) => {
    setter(prev => prev.filter((_, i) => i !== index));
  };

  const addInventoryItem = () => {
    setInventoryItems(prev => [...prev, { name: "", quantity: 1 }]);
  };

  const updateInventoryItem = (index: number, field: 'name' | 'quantity', value: string | number) => {
    setInventoryItems(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const removeInventoryItem = (index: number) => {
    setInventoryItems(prev => prev.filter((_, i) => i !== index));
  };

  const validateForm = (): string | null => {
    if (mediaMainArea.length === 0) return "At least 1 main area photo is required";
    
    const allChecked = checkFloors && checkBathrooms && checkKitchen && checkTrashRemoved &&
      checkEquipmentStored && checkTablesChairs && checkLightsOff && checkOfficeDoor &&
      checkFrontDoor && checkDeepCleaning;
    
    if (!allChecked) return "All checklist items must be checked";
    
    if (issuesFound && !issuesNotes.trim()) {
      return "Please describe the issues found";
    }
    
    if (damageFound && !damageDescription.trim()) {
      return "Please describe the damage found";
    }
    
    if (inventoryUpdateNeeded && inventoryItems.length === 0) {
      return "Please add the required inventory items";
    }
    
    return null;
  };

  const handleSubmit = async () => {
    if (!assignmentId || !staffMember) return;
    
    const validationError = validateForm();
    if (validationError) {
      toast({ title: validationError, variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const reportData: Partial<StandaloneCleaningReport> = {
        cleaner_id: staffMember.id,
        cleaner_name: cleanerName,
        cleaner_role: cleanerRole,
        
        clean_check_floors_swept_mopped: checkFloors,
        clean_check_bathrooms_cleaned: checkBathrooms,
        clean_check_kitchen_cleaned: checkKitchen,
        clean_check_trash_removed: checkTrashRemoved,
        clean_check_equipment_stored: checkEquipmentStored,
        clean_check_tables_chairs_arranged: checkTablesChairs,
        clean_check_lights_off: checkLightsOff,
        clean_check_office_door_locked: checkOfficeDoor,
        clean_check_front_door_locked: checkFrontDoor,
        clean_check_deep_cleaning_done: checkDeepCleaning,
        
        media_front_door: mediaFrontDoor,
        media_main_area: mediaMainArea,
        media_rack: mediaRack,
        media_bathrooms: mediaBathrooms,
        media_kitchen: mediaKitchen,
        media_deep_cleaning: mediaDeepCleaning,
        
        issues_found: issuesFound,
        issues_notes: issuesFound ? issuesNotes : null,
        damage_found: damageFound,
        damage_description: damageFound ? damageDescription : null,
        inventory_update_needed: inventoryUpdateNeeded,
        inventory_items: inventoryUpdateNeeded ? inventoryItems : [],
        
        status: 'completed',
        completed_at: new Date().toISOString(),
      };

      await updateReport.mutateAsync({ assignmentId, reportData });

      toast({
        title: "Report submitted successfully",
        description: "Your cleaning report has been saved.",
      });

      navigate("/staff/standalone");
    } catch (error: any) {
      console.error("Error submitting report:", error);
      toast({
        title: "Error submitting report",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (assignmentLoading || reportLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!assignment) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
          <h3 className="text-lg font-semibold mb-2">Assignment Not Found</h3>
          <Button asChild className="mt-4">
            <Link to="/staff/standalone">Back to My Assignments</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const cleaningTypeLabel = 
    assignment.cleaning_type === 'touch_up' ? 'Touch-Up Cleaning ($40)' :
    assignment.cleaning_type === 'regular' ? 'Regular Cleaning ($80)' :
    assignment.cleaning_type === 'deep' ? 'Deep Cleaning ($150)' : 
    assignment.cleaning_type || 'N/A';

  const isReportCompleted = existingReport?.status === 'completed';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/staff/standalone">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Link>
        </Button>
      </div>

      {/* Assignment Info */}
      <Card>
        <CardHeader>
          <CardTitle>Cleaning Report - Standalone Assignment</CardTitle>
          <CardDescription>
            Date: {assignment.scheduled_date ? format(new Date(assignment.scheduled_date), 'PPP') : 'N/A'}
            {' • '}
            Type: {cleaningTypeLabel}
          </CardDescription>
        </CardHeader>
      </Card>

      {isReportCompleted && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This report has already been completed and submitted. Changes will be saved as updates.
          </AlertDescription>
        </Alert>
      )}

      {/* Cleaner Info */}
      <Card>
        <CardHeader>
          <CardTitle>Cleaner Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Full Name</Label>
              <Input value={cleanerName} onChange={(e) => setCleanerName(e.target.value)} />
            </div>
            <div>
              <Label>Role</Label>
              <Input value={cleanerRole} onChange={(e) => setCleanerRole(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Checklist */}
      <Card>
        <CardHeader>
          <CardTitle>Cleaning Checklist (10 items)</CardTitle>
          <CardDescription>All items must be checked before submitting</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center space-x-2">
            <Checkbox id="floors" checked={checkFloors} onCheckedChange={(c) => setCheckFloors(!!c)} />
            <label htmlFor="floors" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Floors swept and mopped
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="bathrooms" checked={checkBathrooms} onCheckedChange={(c) => setCheckBathrooms(!!c)} />
            <label htmlFor="bathrooms" className="text-sm font-medium">
              Bathrooms cleaned and sanitized
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="kitchen" checked={checkKitchen} onCheckedChange={(c) => setCheckKitchen(!!c)} />
            <label htmlFor="kitchen" className="text-sm font-medium">
              Kitchen cleaned
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="trash" checked={checkTrashRemoved} onCheckedChange={(c) => setCheckTrashRemoved(!!c)} />
            <label htmlFor="trash" className="text-sm font-medium">
              Trash removed
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="equipment" checked={checkEquipmentStored} onCheckedChange={(c) => setCheckEquipmentStored(!!c)} />
            <label htmlFor="equipment" className="text-sm font-medium">
              Equipment stored properly
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="tables" checked={checkTablesChairs} onCheckedChange={(c) => setCheckTablesChairs(!!c)} />
            <label htmlFor="tables" className="text-sm font-medium">
              Tables and chairs arranged
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="lights" checked={checkLightsOff} onCheckedChange={(c) => setCheckLightsOff(!!c)} />
            <label htmlFor="lights" className="text-sm font-medium">
              Lights off
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="office" checked={checkOfficeDoor} onCheckedChange={(c) => setCheckOfficeDoor(!!c)} />
            <label htmlFor="office" className="text-sm font-medium">
              Office door locked
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="frontdoor" checked={checkFrontDoor} onCheckedChange={(c) => setCheckFrontDoor(!!c)} />
            <label htmlFor="frontdoor" className="text-sm font-medium">
              Front door locked
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="deep" checked={checkDeepCleaning} onCheckedChange={(c) => setCheckDeepCleaning(!!c)} />
            <label htmlFor="deep" className="text-sm font-medium">
              Deep cleaning done (if applicable)
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Media Uploads */}
      <Card>
        <CardHeader>
          <CardTitle>Required Photos</CardTitle>
          <CardDescription>
            Main area photos are REQUIRED (minimum 1). All others are optional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Main Area (REQUIRED) */}
          <div>
            <Label className="text-base font-semibold">Main Area (REQUIRED) *</Label>
            <p className="text-xs text-muted-foreground mb-2">Minimum 1 photo</p>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {mediaMainArea.map((url, idx) => (
                <div key={idx} className="relative">
                  <img src={url} alt={`Main area ${idx + 1}`} className="w-full h-24 object-cover rounded" />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-1 right-1 h-6 w-6"
                    onClick={() => removeMedia(setMediaMainArea, idx)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading === 'main_area' || mediaMainArea.length >= 10}
              onChange={(e) => handleFileUpload(e, 'main_area', setMediaMainArea, 10)}
            />
            {uploading === 'main_area' && <p className="text-xs text-muted-foreground mt-1">Uploading...</p>}
          </div>

          {/* Other optional media sections */}
          <div>
            <Label>Front Door (Optional)</Label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {mediaFrontDoor.map((url, idx) => (
                <div key={idx} className="relative">
                  <img src={url} alt={`Front door ${idx + 1}`} className="w-full h-24 object-cover rounded" />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-1 right-1 h-6 w-6"
                    onClick={() => removeMedia(setMediaFrontDoor, idx)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading === 'front_door' || mediaFrontDoor.length >= 3}
              onChange={(e) => handleFileUpload(e, 'front_door', setMediaFrontDoor, 3)}
            />
          </div>

          <div>
            <Label>Tables & Chairs Rack (Optional)</Label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {mediaRack.map((url, idx) => (
                <div key={idx} className="relative">
                  <img src={url} alt={`Rack ${idx + 1}`} className="w-full h-24 object-cover rounded" />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-1 right-1 h-6 w-6"
                    onClick={() => removeMedia(setMediaRack, idx)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading === 'rack' || mediaRack.length >= 3}
              onChange={(e) => handleFileUpload(e, 'rack', setMediaRack, 3)}
            />
          </div>

          <div>
            <Label>Bathrooms (Optional)</Label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {mediaBathrooms.map((url, idx) => (
                <div key={idx} className="relative">
                  <img src={url} alt={`Bathroom ${idx + 1}`} className="w-full h-24 object-cover rounded" />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-1 right-1 h-6 w-6"
                    onClick={() => removeMedia(setMediaBathrooms, idx)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading === 'bathrooms' || mediaBathrooms.length >= 5}
              onChange={(e) => handleFileUpload(e, 'bathrooms', setMediaBathrooms, 5)}
            />
          </div>

          <div>
            <Label>Kitchen (Optional)</Label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {mediaKitchen.map((url, idx) => (
                <div key={idx} className="relative">
                  <img src={url} alt={`Kitchen ${idx + 1}`} className="w-full h-24 object-cover rounded" />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-1 right-1 h-6 w-6"
                    onClick={() => removeMedia(setMediaKitchen, idx)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading === 'kitchen' || mediaKitchen.length >= 3}
              onChange={(e) => handleFileUpload(e, 'kitchen', setMediaKitchen, 3)}
            />
          </div>

          {checkDeepCleaning && (
            <div>
              <Label>Deep Cleaning (Optional)</Label>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {mediaDeepCleaning.map((url, idx) => (
                  <div key={idx} className="relative">
                    <img src={url} alt={`Deep cleaning ${idx + 1}`} className="w-full h-24 object-cover rounded" />
                    <Button
                      size="icon"
                      variant="destructive"
                      className="absolute top-1 right-1 h-6 w-6"
                      onClick={() => removeMedia(setMediaDeepCleaning, idx)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Input
                type="file"
                accept="image/*"
                multiple
                disabled={uploading === 'deep_cleaning' || mediaDeepCleaning.length >= 5}
                onChange={(e) => handleFileUpload(e, 'deep_cleaning', setMediaDeepCleaning, 5)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Issues */}
      <Card>
        <CardHeader>
          <CardTitle>Issues Found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox id="issues" checked={issuesFound} onCheckedChange={(c) => setIssuesFound(!!c)} />
            <label htmlFor="issues" className="text-sm font-medium">
              Issues were found during cleaning
            </label>
          </div>
          {issuesFound && (
            <Textarea
              placeholder="Describe the issues found..."
              value={issuesNotes}
              onChange={(e) => setIssuesNotes(e.target.value)}
              rows={4}
            />
          )}
        </CardContent>
      </Card>

      {/* Damage */}
      <Card>
        <CardHeader>
          <CardTitle>Venue Damage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox id="damage" checked={damageFound} onCheckedChange={(c) => setDamageFound(!!c)} />
            <label htmlFor="damage" className="text-sm font-medium">
              Damage was found in the venue
            </label>
          </div>
          {damageFound && (
            <Textarea
              placeholder="Describe the damage found..."
              value={damageDescription}
              onChange={(e) => setDamageDescription(e.target.value)}
              rows={4}
            />
          )}
        </CardContent>
      </Card>

      {/* Inventory */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory Update</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="inventory" 
              checked={inventoryUpdateNeeded} 
              onCheckedChange={(c) => setInventoryUpdateNeeded(!!c)} 
            />
            <label htmlFor="inventory" className="text-sm font-medium">
              Inventory update needed (missing items)
            </label>
          </div>
          {inventoryUpdateNeeded && (
            <div className="space-y-2">
              {inventoryItems.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input
                    placeholder="Product name"
                    value={item.name}
                    onChange={(e) => updateInventoryItem(idx, 'name', e.target.value)}
                  />
                  <Input
                    type="number"
                    placeholder="Quantity"
                    value={item.quantity}
                    onChange={(e) => updateInventoryItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                    className="w-32"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeInventoryItem(idx)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addInventoryItem}>
                Add Item
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Submit Button */}
      <div className="flex justify-end gap-4">
        <Button variant="outline" asChild>
          <Link to="/staff/standalone">Cancel</Link>
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isReportCompleted ? 'Update Report' : 'Submit Report'}
        </Button>
      </div>
    </div>
  );
}
