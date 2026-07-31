"use client";

import Chip, { type ChipProps } from "@mui/material/Chip";

const COLORS: Record<string, ChipProps["color"]> = {
  draft: "default",
  scheduled: "info",
  publishing: "warning",
  published: "success",
  failed: "error",
  active: "success",
  paused: "warning",
  completed: "info",
  connected: "success",
  disconnected: "default",
  error: "error",
  success: "success",
  warning: "warning",
  info: "info",
};

export default function StatusChip({
  status,
  size = "small",
}: {
  status: string;
  size?: ChipProps["size"];
}) {
  return (
    <Chip
      label={status}
      size={size}
      color={COLORS[status] ?? "default"}
      variant={COLORS[status] === "default" ? "outlined" : "filled"}
    />
  );
}
