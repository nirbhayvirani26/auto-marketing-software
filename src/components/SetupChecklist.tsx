"use client";

import * as React from "react";
import {
  Alert,
  AlertTitle,
  Collapse,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Button,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import { apiFetch } from "@/lib/client";

type Check = { ok: boolean; label: string; hint?: string; optional?: boolean };
type Health = Record<string, Check>;

/**
 * The banner on the dashboard listing what is still unconfigured.
 * Once everything is set it disappears on its own.
 */
export default function SetupChecklist() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    apiFetch<Health>("/api/health").then(setHealth).catch(() => setHealth(null));
  }, []);

  if (!health) return null;

  const checks = Object.values(health);
  const missing = checks.filter((check) => !check.ok && !check.optional);
  if (missing.length === 0) return null;

  return (
    <Alert
      severity="warning"
      action={
        <Button size="small" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Hide" : "Show all"}
        </Button>
      }
    >
      <AlertTitle>Setup is incomplete — {missing.length} left to do</AlertTitle>
      {missing.map((check) => check.label).join(" · ")}

      <Collapse in={expanded}>
        <List dense sx={{ mt: 1 }}>
          {checks.map((check) => (
            <ListItem key={check.label} disableGutters>
              <ListItemIcon sx={{ minWidth: 32 }}>
                {check.ok ? (
                  <CheckCircleIcon fontSize="small" color="success" />
                ) : (
                  <CancelIcon
                    fontSize="small"
                    color={check.optional ? "disabled" : "error"}
                  />
                )}
              </ListItemIcon>
              <ListItemText
                primary={`${check.label}${check.optional ? " (optional)" : ""}`}
                secondary={check.ok ? undefined : check.hint}
                primaryTypographyProps={{ fontSize: 14 }}
              />
            </ListItem>
          ))}
        </List>
      </Collapse>
    </Alert>
  );
}
