"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
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
  avatarUrl?: string;
  status: string;
  createdAt: string;
};

type Discovered = {
  index: number;
  platform: "facebook" | "instagram";
  displayName: string;
  pageId?: string;
  igUserId?: string;
  avatarUrl?: string;
  alreadyConnected: boolean;
};

const EMPTY = {
  platform: "facebook" as "facebook" | "instagram",
  displayName: "",
  pageId: "",
  igUserId: "",
  accessToken: "",
};

function AccountsInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [manualOpen, setManualOpen] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY);
  const [saving, setSaving] = React.useState(false);

  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [discovered, setDiscovered] = React.useState<Discovered[]>([]);
  const [picked, setPicked] = React.useState<number[]>([]);
  const [connecting, setConnecting] = React.useState(false);

  const load = React.useCallback(() => {
    apiFetch<Account[]>("/api/accounts")
      .then(setAccounts)
      .catch((e) => setError(e.message));
  }, []);

  React.useEffect(load, [load]);

  // OAuth callback `?connect=1` ke `?error=…` saathe pacho mokle che.
  React.useEffect(() => {
    const oauthError = params.get("error");
    if (oauthError) {
      setError(oauthError);
      router.replace("/admin/accounts");
      return;
    }
    if (params.get("connect") === "1") {
      router.replace("/admin/accounts");
      apiFetch<{ accounts: Discovered[] }>("/api/oauth/meta/pending")
        .then((data) => {
          setDiscovered(data.accounts);
          setPicked(
            data.accounts.filter((a) => !a.alreadyConnected).map((a) => a.index),
          );
          setPickerOpen(true);
        })
        .catch((e) => setError(e.message));
    }
  }, [params, router]);

  async function handleConfirmConnect() {
    setConnecting(true);
    setError(null);
    try {
      const result = await apiFetch<{ connected: number; accounts: string[] }>(
        "/api/oauth/meta/pending",
        { method: "POST", json: { indexes: picked } },
      );
      setPickerOpen(false);
      setNotice(
        `${result.connected} account connect thaya: ${result.accounts.join(", ")}`,
      );
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  async function handleManualSave() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/accounts", { method: "POST", json: form });
      setManualOpen(false);
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
        subtitle="Facebook thi login karo — Pages ane Instagram accounts aapoaap madi jashe"
        action={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setManualOpen(true)}
            >
              Manual
            </Button>
            <Button
              variant="contained"
              startIcon={<FacebookIcon />}
              href="/api/oauth/meta/start"
              sx={{ bgcolor: "#1877F2", "&:hover": { bgcolor: "#145FC7" } }}
            >
              Connect with Facebook
            </Button>
          </Stack>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Alert severity="info">
        <strong>Connect with Facebook</strong> ek j vaar ma tamara badha Pages
        ane tema jodayela Instagram Business accounts lai aave che — Page ID ke
        token hathe nakhva nathi padta. (Aa mate <code>META_APP_ID</code> ane{" "}
        <code>META_APP_SECRET</code> .env ma joiye.)
      </Alert>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Account</TableCell>
                <TableCell>Platform</TableCell>
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
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Avatar src={account.avatarUrl} sx={{ width: 32, height: 32 }}>
                        {account.displayName.charAt(0).toUpperCase()}
                      </Avatar>
                      <Typography variant="body2">{account.displayName}</Typography>
                    </Stack>
                  </TableCell>
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

      {/* ---- OAuth pachi: kaya accounts connect karva? ---- */}
      <Dialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Kaya accounts connect karva che?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1 }}>
            Tamara Facebook account ma {discovered.length} account madya.
          </DialogContentText>
          <List dense>
            {discovered.map((account) => (
              <ListItemButton
                key={account.index}
                onClick={() =>
                  setPicked((current) =>
                    current.includes(account.index)
                      ? current.filter((i) => i !== account.index)
                      : [...current, account.index],
                  )
                }
              >
                <Checkbox
                  edge="start"
                  checked={picked.includes(account.index)}
                  tabIndex={-1}
                  disableRipple
                />
                <ListItemAvatar>
                  <Avatar src={account.avatarUrl} sx={{ width: 32, height: 32 }}>
                    {account.platform === "facebook" ? (
                      <FacebookIcon fontSize="small" />
                    ) : (
                      <InstagramIcon fontSize="small" />
                    )}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={account.displayName}
                  secondary={
                    account.alreadyConnected
                      ? `${account.platform} · pehla thi connected (token update thashe)`
                      : account.platform
                  }
                />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPickerOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleConfirmConnect}
            disabled={connecting || picked.length === 0}
            startIcon={connecting ? <CircularProgress size={16} /> : undefined}
          >
            {picked.length} account connect karo
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Manual add (OAuth vagar) ---- */}
      <Dialog
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Manual account add karo</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Meta app na hoy tyare aa vapro — Graph API Explorer mathi ID ane
            token levo pade che.
          </Alert>
          <Stack spacing={2}>
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
              helperText="DB ma store thashe, UI ma pachu nahi dekhaay"
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setManualOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleManualSave} disabled={saving}>
            {saving ? "Save thai rahyu…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Divider />
    </Stack>
  );
}

export default function AccountsPage() {
  return (
    <React.Suspense fallback={null}>
      <AccountsInner />
    </React.Suspense>
  );
}
