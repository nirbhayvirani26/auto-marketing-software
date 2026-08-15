"use client";

import { Box, Stack, Typography } from "@mui/material";

/**
 * The heading every admin page starts with: what this screen is, one line on
 * what it is for, and the primary action on the right.
 */
export default function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      justifyContent="space-between"
      alignItems={{ xs: "stretch", sm: "flex-start" }}
      spacing={2}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h5" component="h1">
          {title}
        </Typography>
        {subtitle && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.75, maxWidth: 640 }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
    </Stack>
  );
}
