"use client";

import * as React from "react";
import {
  Alert,
  Button,
  Card,
  Chip,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  IconButton,
} from "@mui/material";
import KeyIcon from "@mui/icons-material/VpnKeyOutlined";
import PageHeader from "@/components/PageHeader";
import { apiFetch } from "@/lib/client";

type User = {
  _id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt: string;
  organization?: { _id: string; name: string; status: string };
};

const ROLES = ["superadmin", "owner", "admin", "member"];

export default function SuperAdminUsers() {
  const [users, setUsers] = React.useState<User[]>([]);
  const [search, setSearch] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    apiFetch<User[]>(
      `/api/superadmin/users${search ? `?q=${encodeURIComponent(search)}` : ""}`,
    )
      .then(setUsers)
      .catch((e) => setError(e.message));
  }, [search]);

  React.useEffect(load, [load]);

  async function patch(userId: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await apiFetch("/api/superadmin/users", {
        method: "PATCH",
        json: { userId, ...body },
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function resetPassword(user: User) {
    const newPassword = prompt(`${user.email} — navo password (min 8 chars):`);
    if (!newPassword) return;
    if (newPassword.length < 8) {
      setError("Password ochha ma ochho 8 character no hovo joiye");
      return;
    }
    await patch(user._id, { newPassword });
    setNotice(`${user.email} no password badlayo`);
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Users"
        subtitle="Kayo user kai organization ma che, ane eno role"
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <TextField
        label="Search name ke email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ maxWidth: 320 }}
      />

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Organization</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Verified</TableCell>
                <TableCell>Last login</TableCell>
                <TableCell>Active</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user._id} hover>
                  <TableCell>
                    <Typography variant="subtitle2">{user.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {user.email}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {user.organization ? (
                      <>
                        <Typography variant="body2">
                          {user.organization.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {user.organization.status}
                        </Typography>
                      </>
                    ) : (
                      <Chip size="small" color="error" label="platform" />
                    )}
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      size="small"
                      value={user.role}
                      onChange={(e) => patch(user._id, { role: e.target.value })}
                      sx={{ minWidth: 120 }}
                    >
                      {ROLES.map((role) => (
                        <MenuItem key={role} value={role}>
                          {role}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={user.emailVerified}
                      onChange={(e) =>
                        patch(user._id, { emailVerified: e.target.checked })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString()
                        : "kadi nahi"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={user.active}
                      onChange={(e) => patch(user._id, { active: e.target.checked })}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Password reset karo">
                      <IconButton size="small" onClick={() => resetPassword(user)}>
                        <KeyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Stack>
  );
}
