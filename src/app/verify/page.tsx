"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import MarkEmailReadIcon from "@mui/icons-material/MarkEmailReadOutlined";
import { apiFetch } from "@/lib/client";

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const devCode = params.get("dev");

  const [code, setCode] = React.useState(devCode ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ role: string }>("/api/auth/verify-otp", {
        method: "POST",
        json: { email, code },
      });
      router.replace(result.role === "superadmin" ? "/superadmin" : "/admin");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError(null);
    try {
      const result = await apiFetch<{ devCode?: string }>("/api/auth/verify-otp", {
        method: "PUT",
        json: { email },
      });
      if (result.devCode) {
        setCode(result.devCode);
        setNotice(`SMTP set nathi — dev code: ${result.devCode}`);
      } else {
        setNotice("Navo code email par moklyo che");
      }
    } catch (e) {
      setError((e as Error).message);
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
                color: "#fff",
              }}
            >
              <MarkEmailReadIcon />
            </Box>
            <Typography variant="h5">Email verify karo</Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              6-digit code moklyo che <strong>{email}</strong> par
            </Typography>
          </Stack>

          {devCode && (
            <Alert severity="info" sx={{ mb: 2 }}>
              SMTP set nathi, etle code ahiya batavyo che: <strong>{devCode}</strong>
            </Alert>
          )}
          {notice && (
            <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
              {notice}
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                fullWidth
                autoFocus
                slotProps={{
                  htmlInput: {
                    inputMode: "numeric",
                    style: {
                      fontSize: 28,
                      letterSpacing: 10,
                      textAlign: "center",
                      fontWeight: 700,
                    },
                  },
                }}
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={loading || code.length < 4}
                fullWidth
              >
                {loading ? "Verify thai rahyu…" : "Verify karo"}
              </Button>
              <Button onClick={handleResend} size="small">
                Code na malyo? Fari moklo
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

export default function VerifyPage() {
  return (
    <React.Suspense fallback={null}>
      <VerifyForm />
    </React.Suspense>
  );
}
