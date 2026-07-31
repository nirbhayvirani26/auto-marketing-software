"use client";

import * as React from "react";
import {
  Alert,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import FacebookIcon from "@mui/icons-material/Facebook";
import InstagramIcon from "@mui/icons-material/Instagram";
import PageHeader from "@/components/PageHeader";
import StatusChip from "@/components/StatusChip";
import { apiFetch } from "@/lib/client";

type Account = {
  _id: string;
  platform: "facebook" | "instagram";
  displayName: string;
  pageId?: string;
  igUserId?: string;
  status: string;
  createdAt: string;
};

const EMPTY = {
  platform: "facebook" as "facebook" | "instagram",
  displayName: "",
  pageId: "",
  igUserId: "",
  accessToken: "",
};

export default function AccountsPage() {
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(() => {
    apiFetch<Account[]>("/api/accounts")
      .then(setAccounts)
      .catch((e) => setError(e.message));
  }, []);

  React.useEffect(load, [load]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/accounts", { method: "POST", json: form });
      setOpen(false);
      setForm(EMPTY);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Aa account delete karvu che?")) return;
    try {
      await apiFetch(`/api/accounts/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Social Accounts"
        subtitle="Facebook Page ane Instagram Business account connect karo"
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpen(true)}
          >
            Account add karo
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Platform</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Page / IG ID</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      Have sudhi koi account connect nathi thayu.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {accounts.map((account) => (
                <TableRow key={account._id} hover>
                  <TableCell>
                    <Chip
                      size="small"
                      icon={
                        account.platform === "facebook" ? (
                          <FacebookIcon />
                        ) : (
                          <InstagramIcon />
                        )
                      }
                      label={account.platform}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>{account.displayName}</TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {account.pageId || account.igUserId || "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusChip status={account.status} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(account._id)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Social account add karo</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Platform"
              value={form.platform}
              onChange={(e) =>
                setForm({
                  ...form,
                  platform: e.target.value as "facebook" | "instagram",
                })
              }
              fullWidth
            >
              <MenuItem value="facebook">Facebook Page</MenuItem>
              <MenuItem value="instagram">Instagram Business</MenuItem>
            </TextField>

            <TextField
              label="Display name"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="e.g. My Brand Page"
              fullWidth
            />

            {form.platform === "facebook" ? (
              <TextField
                label="Facebook Page ID"
                value={form.pageId}
                onChange={(e) => setForm({ ...form, pageId: e.target.value })}
                helperText="Graph API Explorer ma /me/accounts thi malse"
                fullWidth
              />
            ) : (
              <TextField
                label="Instagram Business Account ID"
                value={form.igUserId}
                onChange={(e) => setForm({ ...form, igUserId: e.target.value })}
                helperText="Page na instagram_business_account field mathi malse"
                fullWidth
              />
            )}

            <TextField
              label="Page Access Token"
              value={form.accessToken}
              onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
              type="password"
              helperText="Long-lived Page token — DB ma store thashe, UI ma pachu nahi dekhaay"
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? "Save thai rahyu…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
