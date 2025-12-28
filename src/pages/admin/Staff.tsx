import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Users, Plus, Edit, Filter } from "lucide-react";
import { useStaffMembers, useCreateStaffMember, useUpdateStaffMember } from "@/hooks/useAdminData";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const staffRoles = ["Custodial", "Production", "Assistant"];

export default function Staff() {
  const { toast } = useToast();
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<string>("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formRole, setFormRole] = useState("");
  const [formActive, setFormActive] = useState(true);

  const { data: staffMembers, isLoading } = useStaffMembers({
    role: roleFilter && roleFilter !== "all" ? roleFilter : undefined,
    isActive: activeFilter === "all" || activeFilter === "" ? undefined : activeFilter === "true",
  });

  const createStaff = useCreateStaffMember();
  const updateStaff = useUpdateStaffMember();

  const resetForm = () => {
    setFormName("");
    setFormEmail("");
    setFormPhone("");
    setFormRole("");
    setFormActive(true);
  };

  const handleAdd = async () => {
    if (!formName || !formRole) {
      toast({ title: "Name and role are required", variant: "destructive" });
      return;
    }
    try {
      await createStaff.mutateAsync({
        full_name: formName,
        email: formEmail || null,
        phone: formPhone || null,
        role: formRole,
        is_active: formActive,
      });
      toast({ title: "Staff member added" });
      setIsAddOpen(false);
      resetForm();
    } catch {
      toast({ title: "Failed to add staff member", variant: "destructive" });
    }
  };

  const handleEdit = (staff: {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    role: string;
    is_active: boolean;
  }) => {
    setEditingStaff(staff.id);
    setFormName(staff.full_name);
    setFormEmail(staff.email || "");
    setFormPhone(staff.phone || "");
    setFormRole(staff.role);
    setFormActive(staff.is_active);
  };

  const handleUpdate = async () => {
    if (!editingStaff || !formName || !formRole) return;
    try {
      await updateStaff.mutateAsync({
        id: editingStaff,
        updates: {
          full_name: formName,
          email: formEmail || null,
          phone: formPhone || null,
          role: formRole,
          is_active: formActive,
        },
      });
      toast({ title: "Staff member updated" });
      setEditingStaff(null);
      resetForm();
    } catch {
      toast({ title: "Failed to update staff member", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-foreground">Staff</h1>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}>
              <Plus className="h-4 w-4 mr-2" />
              Add Staff Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Staff Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Full Name *</label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">Phone</label>
                <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">Role *</label>
                <Select value={formRole} onValueChange={setFormRole}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffRoles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={formActive} onCheckedChange={(c) => setFormActive(!!c)} />
                <label className="text-sm">Active</label>
              </div>
              <Button onClick={handleAdd} className="w-full">
                Add Staff Member
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Role</label>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {staffRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Status</label>
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Staff Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Staff Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading staff..</p>
          ) : staffMembers?.length === 0 ? (
            <p className="text-muted-foreground">No staff members found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffMembers?.map((staff) => (
                  <TableRow key={staff.id}>
                    <TableCell className="font-medium">{staff.full_name}</TableCell>
                    <TableCell>{staff.email || "-"}</TableCell>
                    <TableCell>{staff.phone || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{staff.role.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={staff.is_active ? "default" : "secondary"}>
                        {staff.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>{format(new Date(staff.created_at), "PP")}</TableCell>
                    <TableCell>
                      <Dialog open={editingStaff === staff.id} onOpenChange={(open) => !open && setEditingStaff(null)}>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(staff)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Edit Staff Member</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div>
                              <label className="text-sm font-medium">Full Name *</label>
                              <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
                            </div>
                            <div>
                              <label className="text-sm font-medium">Email *</label>
                              <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
                            </div>
                            <div>
                              <label className="text-sm font-medium">Phone</label>
                              <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} />
                            </div>
                            <div>
                              <label className="text-sm font-medium">Role *</label>
                              <Select value={formRole} onValueChange={setFormRole}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select role" />
                                </SelectTrigger>
                                <SelectContent>
                                  {staffRoles.map((role) => (
                                    <SelectItem key={role} value={role}>
                                      {role.replace(/_/g, " ")}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox checked={formActive} onCheckedChange={(c) => setFormActive(!!c)} />
                              <label className="text-sm">Active</label>
                            </div>
                            <Button onClick={handleUpdate} className="w-full">
                              Update Staff Member
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
