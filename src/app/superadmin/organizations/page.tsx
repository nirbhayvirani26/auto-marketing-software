"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
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
import TuneIcon from "@mui/icons-material/TuneOutlined";
import RefreshIcon from "@mui/icons-material/RefreshOutlined";
import PageHeader from "@/components/PageHeader";
import StatusChip from "@/components/StatusChip";
import { apiFetch } from "@/lib/client";

const MODULES = [
  { key: "posts", label: "Posts" },
  { key: "campaigns", label: "Campaigns" },
  { key: "automations", label: "Automations" },
  { key: "autoDm", label: "Auto DM & replies" },
  { key: "aiGeneration", label: "AI generation" },
  { key: "n8n", label: "n8n integration" },
  { key: "apiTokens", label: "API tokens" },
  { key: "whiteLabel", label: "White-label" },
  { key: "analytics", label: "Analytics" },
] as const;

const LIMITS = [
  { key: "brands", label: "Brands" },
  { key: "socialAccounts", label: "Social accounts" },
  { key: "postsPerMonth", label: "Posts / month" },
  { key: "users", label: "Team members" },
  { key: "automations", label: "Automations" },
  { key: "commentRules", label: "DM rules" },
] as const;

type Org = {
  _id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  trialEndsAt?: string;
  notes?: string;
  moduleOverrides?: Record<string, boolean>;
  limitOverrides?: Record<string, number>;
  plan?: {
    _id: string;
    name: string;
    key: string;
    priceMonthly: number;
    limits: Record<string, number>;
    modules: Record<string, boolean>;
  };
  owner?: { name: string; email: string; lastLoginAt?: string };
  usageCounts: {
    brands: number;
    socialAccounts: number;
    posts: number;
    automations: number;
    users: number;
  };
};

type Plan = { _id: string; key: string; name: string };

/** null means use the plan's value; true or false overrides it. */
type TriState = "inherit" | "on" | "off";

export default function SuperAdminOrganizations() {
  const [orgs, setOrgs] = React.useState<Org[]>([]);
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [search, setSearch] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [editing, setEditing] = React.useState<Org | null>(null);
  const [draft, setDraft] = React.useState({
    planKey: "",
    status: "",
    notes: "",
    modules: {} as Record<string, TriState>,
    limits: {} as Record<string, string>,
  });
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(() => {
    Promise.all([
      apiFetch<Org[]>(
        `/api/superadmin/organizations${search ? `?q=${encodeURIComponent(search)}` : ""}`,
      ),
      apiFetch<Plan[]>("/api/superadmin/plans"),
    ])
      .then(([o, p]) => {
        setOrgs(o);
        setPlans(p);
      })
      .catch((e) => setError(e.message));
  }, [search]);

  React.useEffect(load, [load]);

  function openEditor(org: Org) {
    setEditing(org);
    setDraft({
      planKey: org.plan?.key ?? "",
      status: org.status,
      notes: org.notes ?? "",
      modules: Object.fromEntries(
        MODULES.map((m) => {
          const override = org.moduleOverrides?.[m.key];
          return [
            m.key,
            typeof override === "boolean"
              ? override
                ? "on"
                : "off"
              : "inherit",
          ];
        }),
      ) as Record<string, TriState>,
      limits: Object.fromEntries(
        LIMITS.map((l) => [
          l.key,
          org.limitOverrides?.[l.key] !== undefined
            ? String(org.limitOverrides[l.key])
            : "",
        ]),
      ),
    });
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/superadmin/organizations/${editing._id}`, {
        method: "PATCH",
        json: {
          planKey: draft.planKey || undefined,
          status: draft.status || undefined,
          notes: draft.notes,
          // "inherit" -> null (override kadhi naakho)
          moduleOverrides: Object.fromEntries(
            Object.entries(draft.modules).map(([key, value]) => [
              key,
              value === "inherit" ? null : value === "on",
            ]),
          ),
          limitOverrides: Object.fromEntries(
            Object.entries(draft.limits).map(([key, value]) => [
              key,
              value.trim() === "" ? null : Number(value),
            ]),
          ),
        },
      });
      setNotice(`"${editing.name}" was updated`);
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function effectiveLimit(org: Org, key: string): string {
    const override = org.limitOverrides?.[key];
    const value = override ?? org.plan?.limits?.[key] ?? 0;
    return value === -1 ? "∞" : String(value);
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Organizations"
        subtitle="Who runs which organization, on which plan, and how much they have used."
        action={
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>
            Refresh
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <TextField
        label="Search organization"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ maxWidth: 320 }}
      />

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Organization</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Plan</TableCell>
                <TableCell>Usage (brands / accounts / posts)</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Manage</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orgs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No organizations found.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {orgs.map((org) => (
                <TableRow key={org._id} hover>
                  <TableCell>
                    <Typography variant="subtitle2">{org.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      /{org.slug} · {new Date(org.createdAt).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{org.owner?.name ?? "—"}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {org.owner?.email}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={org.plan?.name ?? "—"} />
                    <Typography variant="caption" color="text.secondary" display="block">
                      ₹{(org.plan?.priceMonthly ?? 0).toLocaleString("en-IN")}/mo
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                      {org.usageCounts.brands}/{effectiveLimit(org, "brands")}
                      {"  "}
                      {org.usageCounts.socialAccounts}/
                      {effectiveLimit(org, "socialAccounts")}
                      {"  "}
                      {org.usageCounts.posts}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {org.usageCounts.users} users · {org.usageCounts.automations} automations
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusChip status={org.status} />
                    {(org.moduleOverrides &&
                      Object.keys(org.moduleOverrides).length > 0) ||
                    (org.limitOverrides &&
                      Object.keys(org.limitOverrides).length > 0) ? (
                      <Chip
                        size="small"
                        variant="outlined"
                        label="custom"
                        sx={{ mt: 0.5, height: 20, fontSize: 11 }}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Plan, modules ane limits badlo">
                      <Button
                        size="small"
                        startIcon={<TuneIcon />}
                        onClick={() => openEditor(org)}
                      >
                        Manage
                      </Button>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* ---- Per-organization editor ---- */}
      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Manage {editing?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                select
                label="Plan"
                value={draft.planKey}
                onChange={(e) => setDraft({ ...draft, planKey: e.target.value })}
                fullWidth
              >
                {plans.map((plan) => (
                  <MenuItem key={plan._id} value={plan.key}>
                    {plan.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Status"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                fullWidth
              >
                {["trial", "active", "past_due", "suspended", "cancelled"].map(
                  (status) => (
                    <MenuItem key={status} value={status}>
                      {status}
                    </MenuItem>
                  ),
                )}
              </TextField>
            </Stack>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Modules
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Leave it on &quot;Plan default&quot; to follow the plan. Switch it on or off
                to aa organization mate j override thashe.
              </Typography>
              <Divider sx={{ my: 1.5 }} />
              <Stack spacing={0.5}>
                {MODULES.map((module) => {
                  const planValue = editing?.plan?.modules?.[module.key];
                  return (
                    <Stack
                      key={module.key}
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      sx={{ py: 0.5 }}
                    >
                      <Box>
                        <Typography variant="body2">{module.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          plan ma: {planValue ? "on" : "off"}
                        </Typography>
                      </Box>
                      <RadioGroup
                        row
                        value={draft.modules[module.key] ?? "inherit"}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            modules: {
                              ...draft.modules,
                              [module.key]: e.target.value as TriState,
                            },
                          })
                        }
                      >
                        <FormControlLabel
                          value="inherit"
                          control={<Radio size="small" />}
                          label={<Typography variant="caption">Plan pramane</Typography>}
                        />
                        <FormControlLabel
                          value="on"
                          control={<Radio size="small" color="success" />}
                          label={<Typography variant="caption">On</Typography>}
                        />
                        <FormControlLabel
                          value="off"
                          control={<Radio size="small" color="error" />}
                          label={<Typography variant="caption">Off</Typography>}
                        />
                      </RadioGroup>
                    </Stack>
                  );
                })}
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Limits
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Khali rakho to plan ni limit chale. <code>-1</code> = unlimited.
              </Typography>
              <Divider sx={{ my: 1.5 }} />
              <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2}>
                {LIMITS.map((limit) => (
                  <TextField
                    key={limit.key}
                    label={limit.label}
                    value={draft.limits[limit.key] ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        limits: { ...draft.limits, [limit.key]: e.target.value },
                      })
                    }
                    placeholder={String(
                      editing?.plan?.limits?.[limit.key] ?? 0,
                    )}
                    type="number"
                    sx={{ width: 160 }}
                  />
                ))}
              </Stack>
            </Box>

            <TextField
              label="Internal notes"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={16} /> : undefined}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
