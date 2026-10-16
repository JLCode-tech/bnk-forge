/**
 * User Management page — D-020 redesign.
 *
 * Admin-only user list with bnkhealth shell, KPI strip, chip filter, and a
 * single user table in a SectionCard. Status conveyed by Badge variants only.
 * Create / Edit / Delete dialogs preserved verbatim.
 */
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  CheckCircle2,
  Edit2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Eye,
  Trash2,
  Users,
  UserCheck,
  UserX,
  XCircle,
} from "lucide-react";

import { CollapsibleInnerSidebar } from "@/components/layout/InnerSidebar";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionCard } from "@/components/ui/section-card";
import { TimeAgo } from "@/components/ui/TimeAgo";
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
} from "@/hooks/useUsers";
import { usePageRefresh } from "@/hooks/usePageRefresh";
import { useRole } from "@/hooks/useRole";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserFormData,
  type UpdateUserFormData,
} from "@/schemas";
import type { UserRole, UserWithProjectCount } from "@/types";

const EMPTY_USERS: UserWithProjectCount[] = [];

// ──────────────────────────────────────────────────────────────────────────────
// Role → variant + icon
// ──────────────────────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<
  UserRole,
  {
    label: string;
    icon: typeof Shield;
    variant: "destructive" | "info" | "muted";
  }
> = {
  admin: { label: "Admin", icon: ShieldAlert, variant: "destructive" },
  operator: { label: "Operator", icon: Shield, variant: "info" },
  viewer: { label: "Viewer", icon: Eye, variant: "muted" },
};

function RoleBadge({ role }: { role: UserRole }) {
  const cfg = ROLE_CONFIG[role];
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Create User Dialog
// ──────────────────────────────────────────────────────────────────────────────

function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createUser = useCreateUser();
  const form = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { username: "", email: "", password: "", role: "operator" },
  });

  useEffect(() => {
    if (!open)
      form.reset({ username: "", email: "", password: "", role: "operator" });
  }, [open, form]);

  const onSubmit = async (values: CreateUserFormData) => {
    try {
      await createUser.mutateAsync(values);
      onOpenChange(false);
    } catch {
      /* error handled by mutation */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <DialogHeader>
              <DialogTitle>Create user</DialogTitle>
              <DialogDescription>
                Add a new user account to BNK-Forge.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="jsmith" autoFocus {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="jsmith@company.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Minimum 8 characters"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="admin">
                          Admin — Full access
                        </SelectItem>
                        <SelectItem value="operator">
                          Operator — Deploy &amp; manage own projects
                        </SelectItem>
                        <SelectItem value="viewer">
                          Viewer — Read-only access
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createUser.isPending}>
                {createUser.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create user"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Edit User Dialog
// ──────────────────────────────────────────────────────────────────────────────

function EditUserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserWithProjectCount | null;
}) {
  const updateUser = useUpdateUser();
  const currentUser = useAuthStore((s) => s.user);

  const form = useForm<UpdateUserFormData>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { email: "", role: undefined, is_active: true },
  });

  useEffect(() => {
    if (user && open) {
      form.reset({
        email: user.email,
        role: user.role,
        is_active: user.is_active,
      });
    }
    if (!open) {
      form.reset({ email: "", role: undefined, is_active: true });
    }
  }, [user, open, form]);

  const onSubmit = async (values: UpdateUserFormData) => {
    if (!user) return;
    try {
      await updateUser.mutateAsync({ userId: user.id, data: values });
      onOpenChange(false);
    } catch {
      /* error handled by mutation */
    }
  };

  const isSelf = currentUser?.id === user?.id;
  const isActive = form.watch("is_active");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <DialogHeader>
              <DialogTitle>Edit user — {user?.username}</DialogTitle>
              <DialogDescription>
                Update role, email, or account status.
                {isSelf &&
                  " (Some fields are restricted for your own account.)"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => field.onChange(v as UserRole)}
                      disabled={isSelf}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="operator">Operator</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    {isSelf && (
                      <FormDescription>
                        Cannot change your own role.
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-active">Account active</Label>
                <button
                  id="edit-active"
                  type="button"
                  className={cn(
                    "relative inline-flex h-6 w-11 rounded-full transition-colors",
                    isActive ? "bg-primary" : "bg-muted",
                    isSelf && "opacity-50 cursor-not-allowed",
                  )}
                  onClick={() =>
                    !isSelf && form.setValue("is_active", !isActive)
                  }
                  disabled={isSelf}
                  aria-pressed={isActive}
                >
                  <span
                    className={cn(
                      "inline-block h-5 w-5 rounded-full bg-background transition-transform mt-0.5",
                      isActive ? "translate-x-5 ml-0.5" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateUser.isPending}>
                {updateUser.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Delete Confirmation Dialog
// ──────────────────────────────────────────────────────────────────────────────

function DeleteUserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserWithProjectCount | null;
}) {
  const deleteUser = useDeleteUser();

  const handleDelete = async () => {
    if (!user) return;
    try {
      await deleteUser.mutateAsync(user.id);
      onOpenChange(false);
    } catch {
      /* error handled by mutation */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete user</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{user?.username}</strong>?
            This action cannot be undone.
            {(user?.project_count ?? 0) > 0 && (
              <span className="block mt-2 text-warning">
                This user owns {user?.project_count} project
                {(user?.project_count ?? 0) > 1 ? "s" : ""}. Their projects will
                become unowned.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteUser.isPending}
          >
            {deleteUser.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete user"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────────────────────────────────────

type UserFilter = "all" | "active" | "admins" | "disabled";

const FILTER_LABELS: Record<UserFilter, string> = {
  all: "All Users",
  active: "Active Users",
  admins: "Administrators",
  disabled: "Disabled",
};

export default function UserManagement() {
  const { isAdmin } = useRole();
  const currentUser = useAuthStore((s) => s.user);
  const { data, isLoading } = useUsers();

  const { refresh, isRefreshing } = usePageRefresh();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithProjectCount | null>(
    null,
  );
  const [filter, setFilter] = useState<UserFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const allUsers = useMemo(() => data?.users ?? EMPTY_USERS, [data?.users]);

  const counts = useMemo(() => {
    return {
      all: allUsers.length,
      active: allUsers.filter((u) => u.is_active).length,
      admins: allUsers.filter((u) => u.role === "admin").length,
      disabled: allUsers.filter((u) => !u.is_active).length,
    };
  }, [allUsers]);

  const totalProjects = allUsers.reduce((sum, u) => sum + u.project_count, 0);

  const filteredUsers = useMemo(() => {
    let list = allUsers;
    switch (filter) {
      case "active":
        list = list.filter((u) => u.is_active);
        break;
      case "admins":
        list = list.filter((u) => u.role === "admin");
        break;
      case "disabled":
        list = list.filter((u) => !u.is_active);
        break;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (u) =>
          u.username.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allUsers, filter, searchQuery]);

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">
          User management requires admin access.
        </p>
      </div>
    );
  }

  const filterKeys: UserFilter[] = (
    ["all", "active", "admins", "disabled"] as UserFilter[]
  ).filter((k) => k !== "disabled" || counts.disabled > 0);

  const filterIcons: Record<UserFilter, typeof Users> = {
    all: Users,
    active: CheckCircle2,
    admins: Shield,
    disabled: XCircle,
  };

  return (
    <div className="flex min-h-[calc(100vh-3rem)]">
      {/* Left Sub-Sidebar */}
      <CollapsibleInnerSidebar className="w-52 shrink-0 border-r border-border bg-card/30 p-3 space-y-4">
        <div className="px-2 pt-1 pb-2 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground">
            Users
            <span className="sr-only">User Management</span>
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Manage accounts, roles, and access permissions
          </p>
        </div>

        {/* Group 1: USER VIEWS */}
        <div className="space-y-1">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            USER VIEWS
          </p>
          <div className="space-y-0.5">
            {filterKeys.map((k) => {
              const selected = filter === k;
              const Icon = filterIcons[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  aria-pressed={selected}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-xs transition-colors cursor-pointer text-left",
                    selected
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{FILTER_LABELS[k]}</span>
                  </span>
                  <span
                    className={cn(
                      "text-[11px] tabular-nums px-1.5 py-0.5 rounded",
                      selected
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {counts[k]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary stats card */}
        <div className="pt-2 border-t border-border/60">
          <div className="rounded-lg border border-border bg-card/60 p-2.5 space-y-2">
            {[
              {
                label: "Total users",
                value: counts.all,
                icon: Users,
                toneText: "text-foreground",
              },
              {
                label: "Active",
                value: counts.active,
                icon: UserCheck,
                toneText: "text-success",
              },
              {
                label: "Admins",
                value: counts.admins,
                icon: ShieldAlert,
                toneText: "text-destructive",
              },
              {
                label: "Total projects",
                value: totalProjects,
                icon: Users,
                toneText: "text-foreground",
              },
            ].map((tile) => {
              const Icon = tile.icon;
              return (
                <div
                  key={tile.label}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {tile.label}
                  </span>
                  <span
                    className={cn("font-semibold tabular-nums", tile.toneText)}
                  >
                    {isLoading ? <Skeleton className="h-4 w-6" /> : tile.value}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </CollapsibleInnerSidebar>

      {/* Right Content Pane */}
      <div className="flex-1 min-w-0 p-6 space-y-5 overflow-y-auto">
        {/* Top Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users…"
              aria-label="Search users"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={refresh}
              disabled={isRefreshing}
              aria-label="Refresh"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 mr-1.5",
                  isRefreshing && "animate-spin",
                )}
              />
              Refresh
            </Button>
            <Button
              variant="default"
              onClick={() => setCreateOpen(true)}
              size="sm"
              className="h-9 shrink-0"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add user
            </Button>
          </div>
        </div>

        {/* User table */}
        <SectionCard
          title={`${filteredUsers.length} ${filteredUsers.length === 1 ? "user" : "users"}`}
          compact
        >
          <div className="overflow-x-auto -mx-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    User
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Role
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-center">
                    Projects
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Last login
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Created
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">
                    {/* actions */}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-12 text-muted-foreground"
                    >
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((u) => {
                    const isSelf = u.id === currentUser?.id;
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium text-foreground">
                              {u.username}
                              {isSelf && (
                                <Badge
                                  variant="muted"
                                  className="ml-2 text-2xs"
                                >
                                  you
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {u.email}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <RoleBadge role={u.role} />
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className={cn(
                              "font-mono tabular-nums",
                              u.project_count > 0
                                ? "text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {u.project_count}
                          </span>
                        </TableCell>
                        <TableCell>
                          {u.is_active ? (
                            <Badge variant="success" className="text-xs">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="muted" className="text-xs gap-1">
                              <UserX className="h-3 w-3" />
                              Disabled
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <TimeAgo dateStr={u.last_login_at} fallback="Never" />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <TimeAgo dateStr={u.created_at} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => {
                                setSelectedUser(u);
                                setEditOpen(true);
                              }}
                              aria-label={`Edit ${u.username}`}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => {
                                setSelectedUser(u);
                                setDeleteOpen(true);
                              }}
                              disabled={isSelf}
                              title={
                                isSelf
                                  ? "Cannot delete your own account"
                                  : "Delete user"
                              }
                              aria-label={`Delete ${u.username}`}
                            >
                              <Trash2
                                className={cn(
                                  "h-4 w-4",
                                  isSelf
                                    ? "text-muted-foreground"
                                    : "text-destructive",
                                )}
                              />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        {/* Dialogs */}
        <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
        <EditUserDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          user={selectedUser}
        />
        <DeleteUserDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          user={selectedUser}
        />
      </div>
    </div>
  );
}
