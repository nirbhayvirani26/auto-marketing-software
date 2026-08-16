"use client";

import * as React from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slide,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { TransitionProps } from "@mui/material/transitions";
import WarningIcon from "@mui/icons-material/WarningAmberRounded";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import HelpIcon from "@mui/icons-material/HelpOutline";

/**
 * Confirmation dialogs for the whole admin panel.
 *
 * The browser's own `confirm()` and `prompt()` open a grey box pinned to the
 * top of the window, styled by the browser, ignoring the app's theme entirely.
 * It looks like the page has been hijacked rather than like part of the
 * product.
 *
 * This replaces them with a centred, animated dialog that follows the theme —
 * and keeps the same await-a-boolean shape at the call site, so a guard stays
 * a one-liner:
 *
 *     if (!(await confirm({ title: "Delete this post?" }))) return;
 */

type ConfirmTone = "danger" | "warning" | "neutral";

export type ConfirmOptions = {
  title: string;
  /** The consequence, in a sentence. Say what will actually happen. */
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /**
   * Ask the person to type this exact word before the action is allowed.
   * Reserved for the genuinely irreversible — deleting a brand, not a draft.
   */
  requireText?: string;
  requireTextHint?: string;
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

const ConfirmContext = React.createContext<
  ((options: ConfirmOptions) => Promise<boolean>) | null
>(null);

/** Opens a confirmation dialog and resolves to what the person chose. */
export function useConfirm() {
  const confirm = React.useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return confirm;
}

const Transition = React.forwardRef(function Transition(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  // Rises slightly as it fades in — enough to draw the eye to the centre
  // without feeling slow.
  return <Slide direction="up" ref={ref} timeout={220} {...props} />;
});

const TONE: Record<
  ConfirmTone,
  { colour: "error" | "warning" | "primary"; Icon: typeof WarningIcon }
> = {
  danger: { colour: "error", Icon: DeleteIcon },
  warning: { colour: "warning", Icon: WarningIcon },
  neutral: { colour: "primary", Icon: HelpIcon },
};

export default function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [typed, setTyped] = React.useState("");

  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setTyped("");
        setPending({ ...options, resolve });
      }),
    [],
  );

  function close(result: boolean) {
    pending?.resolve(result);
    setPending(null);
  }

  const tone = TONE[pending?.tone ?? "danger"];
  const Icon = tone.Icon;

  // With a typed confirmation, the button stays disabled until it matches.
  const blocked = Boolean(
    pending?.requireText && typed.trim() !== pending.requireText.trim(),
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      <Dialog
        open={Boolean(pending)}
        onClose={() => close(false)}
        slots={{ transition: Transition }}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: { borderRadius: 3, p: 1 },
          },
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <Box
              sx={{
                width: 44,
                height: 44,
                flexShrink: 0,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                bgcolor: (theme) => theme.palette[tone.colour].main + "1f",
                color: `${tone.colour}.main`,
              }}
            >
              <Icon />
            </Box>
            <Typography variant="h6" sx={{ pt: 0.75 }}>
              {pending?.title}
            </Typography>
          </Stack>
        </DialogTitle>

        <DialogContent sx={{ pl: 10.5, pt: 0 }}>
          {pending?.message && (
            <Typography variant="body2" color="text.secondary">
              {pending.message}
            </Typography>
          )}

          {pending?.requireText && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                {pending.requireTextHint ??
                  `Type ${pending.requireText} to confirm`}
              </Typography>
              <TextField
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !blocked) close(true);
                }}
                placeholder={pending.requireText}
                size="small"
                fullWidth
                autoFocus
              />
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => close(false)} color="inherit">
            {pending?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            onClick={() => close(true)}
            variant="contained"
            color={tone.colour}
            disabled={blocked}
            autoFocus={!pending?.requireText}
          >
            {pending?.confirmLabel ?? "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
