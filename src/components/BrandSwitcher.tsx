"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CheckIcon from "@mui/icons-material/Check";
import AddIcon from "@mui/icons-material/Add";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import { apiFetch } from "@/lib/client";

export type BrandSummary = {
  _id: string;
  name: string;
  color?: string;
  logoUrl?: string;
  accountCount: number;
};

/**
 * Topbar ma brand switcher. Brand badlo etle badhu data — accounts, posts,
 * campaigns, DM rules — e brand nu dekhaay che.
 */
export default function BrandSwitcher() {
  const router = useRouter();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [brands, setBrands] = React.useState<BrandSummary[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [switching, setSwitching] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    apiFetch<{ brands: BrandSummary[]; activeBrandId: string | null }>(
      "/api/brands",
    )
      .then((data) => {
        setBrands(data.brands);
        setActiveId(data.activeBrandId);
      })
      .catch(() => {
        setBrands([]);
      });
  }, []);

  React.useEffect(load, [load]);

  const active = brands.find((brand) => brand._id === activeId);

  async function handleSwitch(id: string) {
    if (id === activeId) {
      setAnchorEl(null);
      return;
    }
    setSwitching(id);
    try {
      await apiFetch(`/api/brands/${id}`, {
        method: "PATCH",
        json: { makeActive: true },
      });
      setActiveId(id);
      setAnchorEl(null);
      // Server components ane badha lists fari load thay.
      router.refresh();
      window.location.reload();
    } finally {
      setSwitching(null);
    }
  }

  if (brands.length === 0) {
    return (
      <Button
        component={Link}
        href="/admin/brands"
        size="small"
        variant="outlined"
        startIcon={<AddIcon />}
      >
        Brand banavo
      </Button>
    );
  }

  return (
    <>
      <Button
        onClick={(e) => setAnchorEl(e.currentTarget)}
        endIcon={<ExpandMoreIcon />}
        sx={{
          textTransform: "none",
          color: "text.primary",
          px: 1,
          minWidth: 0,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Avatar
            src={active?.logoUrl}
            sx={{
              width: 26,
              height: 26,
              bgcolor: active?.color ?? "primary.main",
              fontSize: 13,
            }}
          >
            {active?.name?.charAt(0).toUpperCase()}
          </Avatar>
          <Box sx={{ textAlign: "left", display: { xs: "none", sm: "block" } }}>
            <Typography variant="body2" fontWeight={600} lineHeight={1.1}>
              {active?.name ?? "Brand"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {active?.accountCount ?? 0} accounts
            </Typography>
          </Box>
        </Stack>
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { minWidth: 260 } } }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ px: 2, py: 1, display: "block" }}
        >
          BRANDS
        </Typography>
        {brands.map((brand) => (
          <MenuItem
            key={brand._id}
            selected={brand._id === activeId}
            onClick={() => handleSwitch(brand._id)}
          >
            <ListItemIcon>
              <Avatar
                src={brand.logoUrl}
                sx={{
                  width: 26,
                  height: 26,
                  bgcolor: brand.color ?? "primary.main",
                  fontSize: 13,
                }}
              >
                {brand.name.charAt(0).toUpperCase()}
              </Avatar>
            </ListItemIcon>
            <ListItemText
              primary={brand.name}
              secondary={`${brand.accountCount} accounts`}
            />
            {switching === brand._id ? (
              <CircularProgress size={16} />
            ) : brand._id === activeId ? (
              <CheckIcon fontSize="small" color="primary" />
            ) : null}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem component={Link} href="/admin/brands" onClick={() => setAnchorEl(null)}>
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          Brands manage karo
        </MenuItem>
      </Menu>
    </>
  );
}
