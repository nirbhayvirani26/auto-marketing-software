"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/EditOutlined";
import PageHeader from "@/components/PageHeader";
import { apiFetch } from "@/lib/client";

const MODULES = [
  ["posts", "Posts"],
  ["campaigns", "Campaigns"],
  ["automations", "Automations"],
  ["autoDm", "Auto DM & replies"],
  ["aiGeneration", "AI generation"],
  ["n8n", "n8n integration"],
  ["apiTokens", "API tokens"],
  ["whiteLabel", "White-label"],
  ["analytics", "Analytics"],
] as const;

const LIMITS = [
  ["organizations", "Organizations"],
  ["brands", "Brands"],
  ["socialAccounts", "Social accounts"],
  ["postsPerMonth", "Posts / month"],
  ["users", "Team members"],
  ["automations", "Automations"],
  ["commentRules", "DM rules"],
] as const;

type Plan = {
  _id: string;
  key: string;
  name: string;
  description?: string;
  priceMonthly: number;
  priceYearly: number;
  limits: Record<string, number>;
  modules: Record<string, boolean>;
  highlights: string[];
  popular?: boolean;
  sortOrder: number;
  visible: boolean;
  active: boolean;
  organizationCount: number;
};

const BLANK = {
  key: "",
  name: "",
  description: "",
  priceMonthly: 0,
  priceYearly: 0,
  highlights: "",
  popular: false,
  sortOrder: 10,
  visible: true,
  active: true,
  limits: Object.fromEntries(LIMITS.map(([k]) => [k, "1"])) as Record<string, string>,
  modules: Object.fromEntries(MODULES.map(([k]) => [k, false])) as Record<
    string,
    boolean
  >,
};

export default function SuperAdminPlans() {
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(BLANK);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(() => {
    apiFetch<Plan[]>("/api/superadmin/plans")
      .then(setPlans)
      .catch((e) => setError(e.message));
  }, []);

  React.useEffect(load, [load]);

  function edit(plan: Plan) {
    setDraft({
      key: plan.key,
      name: plan.name,
      description: plan.description ?? "",
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      highlights: (plan.highlights ?? []).join("\n"),
      popular: Boolean(plan.popular),
      sortOrder: plan.sortOrder,
      visible: plan.visible,
      active: plan.active,
      limits: Object.fromEntries(
        LIMITS.map(([k]) => [k, String(plan.limits?.[k] ?? 0)]),
      ),
      modules: Object.fromEntries(
        MODULES.map(([k]) => [k, Boolean(plan.modules?.[k])]),
      ),
    });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/superadmin/plans", {
        method: "POST",
        json: {
          ...draft,
          priceMonthly: Number(draft.priceMonthly),
          priceYearly: Number(draft.priceYearly),
          sortOrder: Number(draft.sortOrder),
          highlights: draft.highlights.split("\n").map((h) => h.trim()).filter(Boolean),
          limits: Object.fromEntries(
            Object.entries(draft.limits).map(([k, v]) => [k, Number(v)]),
          ),
        },
      });
      setOpen(false);
      setNotice(`Plan "${draft.name}" save thayo`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Plans & Pricing"
        subtitle="Create plans, set their prices, and choose which modules each one unlocks."
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setDraft(BLANK);
              setOpen(true);
            }}
          >
            Navo plan
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Grid container spacing={2}>
        {plans.map((plan) => (
          <Grid key={plan._id} size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: "100%", borderColor: plan.popular ? "primary.main" : undefined, borderWidth: plan.popular ? 2 : 1 }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="h6">{plan.name}</Typography>
                      {plan.popular && <Chip size="small" color="primary" label="popular" />}
                      {!plan.visible && <Chip size="small" label="hidden" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      key: {plan.key} · {plan.organizationCount} organizations
                    </Typography>
                  </Box>
                  <Button size="small" startIcon={<EditIcon />} onClick={() => edit(plan)}>
                    Edit
                  </Button>
                </Stack>

                <Typography variant="h5" sx={{ mt: 2 }}>
                  ₹{plan.priceMonthly.toLocaleString("en-IN")}
                  <Typography component="span" variant="body2" color="text.secondary">
                    {" "}/mo
                  </Typography>
                </Typography>

                <Divider sx={{ my: 2 }} />
                <Stack spacing={0.5}>
                  {LIMITS.map(([key, label]) => (
                    <Stack key={key} direction="row" justifyContent="space-between">
                      <Typography variant="caption" color="text.secondary">
                        {label}
                      </Typography>
                      <Typography variant="caption">
                        {plan.limits?.[key] === -1 ? "∞" : (plan.limits?.[key] ?? 0)}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
                <Divider sx={{ my: 2 }} />
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {MODULES.filter(([k]) => plan.modules?.[k]).map(([k, label]) => (
                    <Chip key={k} size="small" variant="outlined" label={label} />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{draft.key ? `Plan edit — ${draft.name}` : "Navo plan"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Key (unique, a-z)"
                value={draft.key}
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                helperText="dakhla: starter, pro, agency"
                fullWidth
              />
              <TextField
                label="Name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                fullWidth
              />
            </Stack>
            <TextField
              label="Description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              fullWidth
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="Price / month (₹)"
                type="number"
                value={draft.priceMonthly}
                onChange={(e) => setDraft({ ...draft, priceMonthly: Number(e.target.value) })}
                fullWidth
              />
              <TextField
                label="Price / year (₹)"
                type="number"
                value={draft.priceYearly}
                onChange={(e) => setDraft({ ...draft, priceYearly: Number(e.target.value) })}
                fullWidth
              />
              <TextField
                label="Sort order"
                type="number"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
                sx={{ width: 130 }}
              />
            </Stack>

            <Divider>Limits (-1 = unlimited)</Divider>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2}>
              {LIMITS.map(([key, label]) => (
                <TextField
                  key={key}
                  label={label}
                  type="number"
                  value={draft.limits[key]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      limits: { ...draft.limits, [key]: e.target.value },
                    })
                  }
                  sx={{ width: 165 }}
                />
              ))}
            </Stack>

            <Divider>Modules</Divider>
            <Stack direction="row" flexWrap="wrap" useFlexGap>
              {MODULES.map(([key, label]) => (
                <FormControlLabel
                  key={key}
                  sx={{ width: 210 }}
                  control={
                    <Switch
                      checked={draft.modules[key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          modules: { ...draft.modules, [key]: e.target.checked },
                        })
                      }
                    />
                  }
                  label={<Typography variant="body2">{label}</Typography>}
                />
              ))}
            </Stack>

            <TextField
              label="Highlights (ek line par ek — pricing page par dekhaay)"
              value={draft.highlights}
              onChange={(e) => setDraft({ ...draft, highlights: e.target.value })}
              multiline
              minRows={4}
              fullWidth
            />

            <Stack direction="row" spacing={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.popular}
                    onChange={(e) => setDraft({ ...draft, popular: e.target.checked })}
                  />
                }
                label="Popular badge"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.visible}
                    onChange={(e) => setDraft({ ...draft, visible: e.target.checked })}
                  />
                }
                label="Pricing page par dekhaado"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.active}
                    onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                  />
                }
                label="Active"
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={save}
            disabled={saving || !draft.key || !draft.name}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
