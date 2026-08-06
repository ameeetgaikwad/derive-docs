import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium tracking-normal transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:bg-zinc-200 disabled:text-zinc-400",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        outline: "border-[0.5px] border-border bg-background hover:bg-zinc-50",
        secondary:
          "border-[0.5px] border-border bg-secondary text-secondary-foreground hover:bg-zinc-50",
        ghost: "hover:bg-secondary",
        link: "underline-offset-4 hover:underline text-primary",
        success: "bg-success text-white hover:bg-success/90",
        accent: "bg-accent text-white hover:bg-orange-600",
      },
      size: {
        default: "px-[0.938rem] py-[0.78125rem]",
        sm: "px-3 py-2 text-xs",
        lg: "h-14 px-5 py-3 text-base",
        icon: "size-10 p-0",
      },
      action: {
        true: "font-semibold uppercase",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, action, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, action, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
