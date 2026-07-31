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
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DarkModeIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeIcon from "@mui/icons-material/LightModeOutlined";
import CampaignIcon from "@mui/icons-material/CampaignOutlined";
import { useColorMode } from "@/theme/ThemeRegistry";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { mode, toggleMode } = useColorMode();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await response.json();

      // Email verify baaki hoy to OTP screen par lai jao.
      if (json?.extra?.needsVerification) {
        const query = new URLSearchParams({ email: json.extra.email });
        if (json.extra.devCode) query.set("dev", json.extra.devCode);
        router.push(`/verify?${query.toString()}`);
        return;
      }

      if (!response.ok || !json.ok) {
        throw new Error(json.error ?? "Login fail thayu");
      }

      // Super admin ne platform panel ma, baki na ne user panel ma.
      const next =
        params.get("next") ||
        (json.data?.isSuperAdmin ? "/superadmin" : "/admin");
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
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

      <Card sx={{ width: "100%", maxWidth: 420 }}>
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
                color: "primary.contrastText",
              }}
            >
              <CampaignIcon />
            </Box>
            <Typography variant="h5">Auto Marketing</Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Admin panel ma login karo
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
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                fullWidth
                autoComplete="email"
                autoFocus
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                fullWidth
                autoComplete="current-password"
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={loading}
                fullWidth
              >
                {loading ? "Login thai rahyu che…" : "Login"}
              </Button>
            </Stack>
          </Box>

          <Divider sx={{ my: 3 }} />
          <Typography variant="body2" textAlign="center">
            Account nathi?{" "}
            <Link href="/register" style={{ color: "inherit" }}>
              <strong>Free ma shuru karo</strong>
            </Link>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}
