"use client";

import * as React from "react";
import {
  Alert,
  Button,
  Card,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/RefreshOutlined";
import PageHeader from "@/components/PageHeader";
import StatusChip from "@/components/StatusChip";
import { apiFetch } from "@/lib/client";

type Log = {
  _id: string;
  level: string;
  action: string;
  message: string;
  actor: string;
  createdAt: string;
};

export default function LogsPage() {
  const [logs, setLogs] = React.useState<Log[]>([]);
  const [level, setLevel] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    apiFetch<Log[]>(`/api/logs${level ? `?level=${level}` : ""}`)
      .then(setLogs)
      .catch((e) => setError(e.message));
  }, [level]);

  React.useEffect(load, [load]);

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Activity Logs"
        subtitle="Every publish, AI generation, automation run and n8n event is recorded here."
        action={
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>
            Refresh
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <TextField
        select
        label="Level"
        value={level}
        onChange={(e) => setLevel(e.target.value)}
        sx={{ maxWidth: 220 }}
      >
        <MenuItem value="">All</MenuItem>
        {["info", "success", "warning", "error"].map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>

      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Level</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Message</TableCell>
                <TableCell>Actor</TableCell>
                <TableCell>Time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      Nothing has been logged yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {logs.map((log) => (
                <TableRow key={log._id} hover>
                  <TableCell>
                    <StatusChip status={log.level} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                      {log.action}
                    </Typography>
                  </TableCell>
                  <TableCell>{log.message}</TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {log.actor}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(log.createdAt).toLocaleString()}
                    </Typography>
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
