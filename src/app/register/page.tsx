"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DarkModeIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeIcon from "@mui/icons-material/LightModeOutlined";
import CampaignIcon from "@mui/icons-material/CampaignOutlined";
import { useColorMode } from "@/theme/ThemeRegistry";
import { apiFetch } from "@/lib/client";

type PublicPlan = { key: string; name: string; priceMonthly: number };

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { mode, toggleMode } = useColorMode();

  const [plans, setPlans] = React.useState<PublicPlan[]>([]);
  const [form, setForm] = React.useState({
    name: "",
    email: "",
    password: "",
    organizationName: "",
    planKey: params.get("plan") ?? "starter",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    apiFetch<PublicPlan[]>("/api/public/plans")
      .then((data) => {
        setPlans(data);
        // URL ma plan na hoy to pehlo plan default.
        if (!params.get("plan") && data[0]) {
          setForm((f) => ({ ...f, planKey: data[0].key }));
        }
      })
      .catch(() => setPlans([]));
  }, [params]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ email: string; devCode?: string }>(
        "/api/auth/register",
        { method: "POST", json: form },
      );
      // SMTP set na hoy to dev code URL ma lai jaiye jethi turant test thai shake.
      const query = new URLSearchParams({ email: result.email });
      if (result.devCode) query.set("dev", result.devCode);
      router.push(`/verify?${query.toString()}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        px: 2,
        py: 6,
        background: (theme) =>
          theme.palette.mode === "dark"
            ? "radial-gradient(1200px 600px at 20% -10%, rgba(91,91,214,0.25), transparent 60%), #0E1015"
            : "radial-gradient(1200px 600px at 20% -10%, rgba(91,91,214,0.18), transparent 60%), #F6F7FB",
      }}
    >
      <Box sx={{ position: "fixed", top: 16, right: 16 }}>
        <Tooltip title={mode === "dark" ? "Light mode" : "Dark mode"}>
          <IconButton onClick={toggleMode}>
            {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      <Card sx={{ width: "100%", maxWidth: 460 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={1} alignItems="center" sx={{ mb: 3 }}>
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: 3,
                display: "grid",
                placeItems: "center",
                bgcolor: "primary.main",
                color: "#fff",
              }}
            >
              <CampaignIcon />
            </Box>
            <Typography variant="h5">Account banavo</Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              14 divas free trial — credit card ni jarur nathi
            </Typography>
          </Stack>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label="Tamaru naam"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                fullWidth
                autoFocus
              />
              <TextField
                label="Company / organization nu naam"
                value={form.organizationName}
                onChange={(e) =>
                  setForm({ ...form, organizationName: e.target.value })
                }
                required
                fullWidth
              />
              <TextField
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                fullWidth
                autoComplete="email"
              />
              <TextField
                label="Password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                fullWidth
                helperText="Ochha ma ochha 8 characters"
                autoComplete="new-password"
              />
              {plans.length > 0 && (
                <TextField
                  select
                  label="Plan"
                  value={form.planKey}
                  onChange={(e) => setForm({ ...form, planKey: e.target.value })}
                  fullWidth
                >
                  {plans.map((plan) => (
                    <MenuItem key={plan.key} value={plan.key}>
                      {plan.name} — ₹{plan.priceMonthly.toLocaleString("en-IN")}/mo
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={loading}
                fullWidth
              >
                {loading ? "Account banai rahyu che…" : "Account banavo"}
              </Button>
            </Stack>
          </Box>

          <Divider sx={{ my: 3 }} />
          <Typography variant="body2" textAlign="center">
            Pehla thi account che?{" "}
            <Link href="/login" style={{ color: "inherit" }}>
              <strong>Login karo</strong>
            </Link>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}

export default function RegisterPage() {
  return (
    <React.Suspense fallback={null}>
      <RegisterForm />
    </React.Suspense>
  );
}
