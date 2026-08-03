import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const textVariants = cva("whitespace-normal tracking-normal", {
  variants: {
    variant: {
      h1: "font-heading text-5xl font-bold leading-[1.08] sm:text-6xl lg:text-7xl",
      h2: "font-heading text-3xl font-bold leading-tight sm:text-4xl",
      h3: "font-heading text-2xl font-bold leading-snug",
      h4: "font-heading text-xl font-bold leading-snug",
      h5: "font-heading text-base font-bold leading-snug",
      "subheading-1": "text-lg font-medium leading-8 sm:text-xl",
      "subheading-2": "font-heading text-sm font-bold uppercase leading-snug",
      "body-large": "text-base font-medium leading-7 sm:text-lg",
      "body-default": "text-sm font-medium leading-6 sm:text-base",
      "body-small": "text-xs font-medium leading-5 sm:text-sm",
      "terminal-heading": "font-mono text-2xl font-medium leading-snug",
      terminal: "font-mono text-sm font-normal leading-6 sm:text-base",
      "terminal-small": "font-mono text-xs font-normal leading-5 sm:text-sm",
    },
  },
  defaultVariants: {
    variant: "body-default",
  },
});

type TextElement =
  | HTMLParagraphElement
  | HTMLHeadingElement
  | HTMLSpanElement
  | HTMLDivElement;

interface TextProps
  extends HTMLAttributes<TextElement>,
    VariantProps<typeof textVariants> {
  as?: React.ElementType;
  children: ReactNode;
}

function Text({
  as: Component = "p",
  className,
  children,
  variant,
  ...props
}: TextProps) {
  return (
    <Component className={cn(textVariants({ variant }), className)} {...props}>
      {children}
    </Component>
  );
}

export { Text, textVariants };
