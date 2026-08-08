"use client";

import * as React from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/CheckCircle";
import PendingIcon from "@mui/icons-material/RadioButtonUnchecked";
import WarningIcon from "@mui/icons-material/WarningAmberOutlined";

import Button from "@mui/material/Button";
import PlayIcon from "@mui/icons-material/PlayArrowOutlined";

import { apiFetch } from "@/lib/client";

type ProbeResult = {
  key: string;
  label: string;
  required: boolean;
  ok: boolean;
  ms: number;
  detail?: string;
  error?: string;
  fix?: string;
};

type Probe = {
  ready: boolean;
  passed: number;
  failed: number;
  blocking: Array<{ label: string; error?: string; fix?: string }>;
  results: ProbeResult[];
};

type Provider = {
  key: string;
  label: string;
  free: boolean;
  configured: boolean;
  note?: string;
};

type Group = {
  key: string;
  title: string;
  required: boolean;
  ready: boolean;
  why: string;
  providers: Provider[];
};

type Status = {
  ready: boolean;
  blocking: Array<{ key: string; title: string; why: string }>;
  groups: Group[];
  runner: { running: number; queued: number; maxConcurrent: number };
  circuitBreakers: Array<{ provider: string; failures: number; openForMs: number }>;
};

/**
 * "Reel Studio chalu thai shakshe ke nahi" — ek j najar ma.
 *
 * Setup page par dekhay che. Dareak jutth ma "aa vagar su nahi chale" pan
 * lakhelu che, jethi user ne khabar pade ke kai key sauthi pehla levi.
 */
export default function StudioReadiness() {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [probe, setProbe] = React.useState<Probe | null>(null);
  const [probing, setProbing] = React.useState(false);

  React.useEffect(() => {
    apiFetch<Status>("/api/system/status")
      .then(setStatus)
      .catch((e) => setError((e as Error).message));
  }, []);

  async function runProbe() {
    setProbing(true);
    setError(null);
    setProbe(null);
    try {
      setProbe(await apiFetch<Probe>("/api/system/probe", { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProbing(false);
    }
  }

  if (error) {
    return (
      <Alert severity="error">Reel Studio ni halat lavi na shakaya: {error}</Alert>
    );
  }
  if (!status) {
    return (
      <Card>
        <CardContent sx={{ textAlign: "center", py: 4 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
          <Typography variant="h6">Reel Studio</Typography>
          <Chip
            size="small"
            color={status.ready ? "success" : "warning"}
            label={status.ready ? "Taiyar che" : `${status.blocking.length} vastu khute che`}
          />
          <Box sx={{ flex: 1 }} />
          {status.runner.running > 0 && (
            <Chip
              size="small"
              variant="outlined"
              label={`${status.runner.running} chalu · ${status.runner.queued} line ma`}
            />
          )}
        </Stack>

        {status.blocking.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <AlertTitle>Aa vagar reel nahi bane</AlertTitle>
            {status.blocking.map((item) => (
              <Typography key={item.key} variant="body2" sx={{ mt: 0.5 }}>
                • <strong>{item.title}</strong> — {item.why}
              </Typography>
            ))}
          </Alert>
        )}

        <Stack spacing={2}>
          {status.groups.map((group) => (
            <Box key={group.key}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {group.ready ? (
                  <CheckIcon color="success" sx={{ fontSize: 18 }} />
                ) : group.required ? (
                  <WarningIcon color="warning" sx={{ fontSize: 18 }} />
                ) : (
                  <PendingIcon sx={{ fontSize: 18, color: "action.disabled" }} />
                )}
                <Typography variant="subtitle2">{group.title}</Typography>
                {!group.required && (
                  <Chip size="small" variant="outlined" label="marji nu" sx={{ height: 18 }} />
                )}
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ ml: 3.4, display: "block" }}>
                {group.why}
              </Typography>

              <Stack
                direction="row"
                spacing={0.75}
                flexWrap="wrap"
                useFlexGap
                sx={{ ml: 3.4, mt: 0.75 }}
              >
                {group.providers.map((provider) => (
                  <Chip
                    key={provider.key}
                    size="small"
                    variant={provider.configured ? "filled" : "outlined"}
                    color={provider.configured ? "success" : "default"}
                    label={`${provider.label}${provider.free ? " · free" : ""}`}
                    title={provider.note}
                  />
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>

        {/* ---- Kharekhar chale che ke nahi ---- */}
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" alignItems="center" spacing={2}>
          <Button
            variant="outlined"
            size="small"
            startIcon={probing ? <CircularProgress size={14} /> : <PlayIcon />}
            onClick={runProbe}
            disabled={probing}
          >
            {probing ? "Test chali rahyu che…" : "Badhu kharekhar chale che? — test karo"}
          </Button>
          <Typography variant="caption" color="text.secondary">
            Dareak service ne ek nani sachi request mokle che. Key set hovi ane
            key <strong>kaam karvi</strong> — e be alag vaat che.
          </Typography>
        </Stack>

        {probe && (
          <Box sx={{ mt: 2 }}>
            <Alert
              severity={probe.ready ? "success" : "error"}
              sx={{ mb: 1.5 }}
            >
              <AlertTitle>
                {probe.passed} pass · {probe.failed} fail
              </AlertTitle>
              {probe.ready
                ? "Badhu kaam kare che — Reel Studio ma javo ane image mukho."
                : probe.blocking.map((item, index) => (
                    <Typography key={index} variant="body2" sx={{ mt: 0.5 }}>
                      • <strong>{item.label}</strong> — {item.error}
                      {item.fix && (
                        <>
                          <br />
                          <em>Upay: {item.fix}</em>
                        </>
                      )}
                    </Typography>
                  ))}
            </Alert>

            <Stack spacing={0.5}>
              {probe.results.map((row) => (
                <Stack key={row.key} direction="row" spacing={1.5} alignItems="center">
                  {row.ok ? (
                    <CheckIcon color="success" sx={{ fontSize: 16 }} />
                  ) : row.required ? (
                    <WarningIcon color="error" sx={{ fontSize: 16 }} />
                  ) : (
                    <WarningIcon color="warning" sx={{ fontSize: 16 }} />
                  )}
                  <Typography variant="body2" sx={{ minWidth: 230 }}>
                    {row.label}
                  </Typography>
                  <Typography
                    variant="caption"
                    color={row.ok ? "text.secondary" : "error.main"}
                    sx={{ flex: 1 }}
                  >
                    {row.detail ?? row.error}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {(row.ms / 1000).toFixed(1)}s
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        )}

        {status.circuitBreakers.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="text.secondary">
              Vaar vaar fail thaya etle atyare skip thai rahya che (thodi var
              ma apoaap fari chalu thashe):
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
              {status.circuitBreakers.map((breaker) => (
                <Chip
                  key={breaker.provider}
                  size="small"
                  color="warning"
                  variant="outlined"
                  label={`${breaker.provider} · ${Math.ceil(breaker.openForMs / 1000)}s`}
                />
              ))}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
