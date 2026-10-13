"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToastClassnames, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// The loading icon also replaces sonner's own grey spinner.
export const toastIcons: ToasterProps["icons"] = {
  success: (
    <CircleCheckIcon className="size-4" />
  ),
  info: (
    <InfoIcon className="size-4" />
  ),
  warning: (
    <TriangleAlertIcon className="size-4" />
  ),
  error: (
    <OctagonXIcon className="size-4" />
  ),
  loading: (
    <Loader2Icon className="size-4 animate-spin" />
  ),
}

// Inline on the toaster, so these beat the grey defaults of sonner's light theme.
export const toasterStyle = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
  "--border-radius": "var(--radius)",
} as React.CSSProperties

// Sonner injects an unlayered stylesheet at runtime with black shadows and focus rings, grey
// description text, a grey cancel fill and a grey close-button hover. Unlayered rules beat
// Tailwind's layered utilities, so the brand overrides are important (`!`). Rich colours stay
// off: their success toast is green.
const focusRing = "focus-visible:ring-3! focus-visible:ring-ring/50!"
export const toastClassNames: ToastClassnames = {
  toast: `cn-toast shadow-md! ${focusRing}`,
  description: "text-muted-foreground!",
  actionButton: focusRing,
  cancelButton: `bg-muted! ${focusRing}`,
  closeButton: `hover:border-border! hover:bg-muted! ${focusRing}`,
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={toastIcons}
      style={toasterStyle}
      toastOptions={{ classNames: toastClassNames }}
      {...props}
    />
  )
}

export { Toaster }
