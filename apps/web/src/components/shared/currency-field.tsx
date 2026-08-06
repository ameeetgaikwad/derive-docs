"use client";

import * as React from "react";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type CurrencyFieldContextValue = {
  size: "large" | "medium";
  mutedLabel?: boolean;
};

const CurrencyFieldContext =
  React.createContext<CurrencyFieldContextValue | null>(null);

function useCurrencyFieldContext() {
  const ctx = React.useContext(CurrencyFieldContext);
  if (!ctx) {
    throw new Error("CurrencyField components must be used within <CurrencyField>");
  }
  return ctx;
}

type RootProps = React.ComponentProps<"div"> & {
  size?: "large" | "medium";
  mutedLabel?: boolean;
};

function Root({ size = "large", mutedLabel, className, ...props }: RootProps) {
  return (
    <CurrencyFieldContext.Provider value={{ size, mutedLabel }}>
      <div
        data-slot="currency-field"
        className={cn("flex w-full flex-col gap-2.5", className)}
        {...props}
      />
    </CurrencyFieldContext.Provider>
  );
}

function Label({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { size, mutedLabel } = useCurrencyFieldContext();
  const isLarge = size === "large";
  return (
    <Text
      variant={isLarge ? "subheading-1" : "body-large"}
      className={cn(
        isLarge && !mutedLabel ? "text-zinc-800" : "text-muted-foreground",
        "max-w-[90%]",
        className
      )}
    >
      {children}
    </Text>
  );
}

type ControlProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  prefix?: string;
  hasError?: boolean;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
};

function Control({
  value,
  onChange,
  disabled = false,
  placeholder,
  prefix = "$",
  hasError,
  subtitle,
  trailing,
  inputMode = "decimal",
}: ControlProps) {
  const { size } = useCurrencyFieldContext();
  const isEmpty = !value;
  const isLarge = size === "large";
  const textColorClass = hasError
    ? "text-red-500"
    : isEmpty
      ? "text-zinc-400"
      : "text-foreground";

  return (
    <div className="flex w-full items-center justify-between gap-5">
      <div className="flex min-w-0 flex-col gap-[0.313rem] md:flex-row md:flex-wrap md:items-baseline md:gap-2.5">
        <div className={cn("flex min-w-0 items-baseline", textColorClass)}>
          {prefix && (
            <span
              className={cn(
                "select-none font-heading font-bold leading-none tracking-normal",
                isLarge ? "text-4xl xl:text-5xl" : "text-3xl"
              )}
            >
              {prefix}
            </span>
          )}
          <input
            disabled={disabled}
            inputMode={inputMode}
            placeholder={placeholder ?? "0"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={cn(
              "hide-input-spin-buttons min-w-0 bg-transparent font-heading font-bold leading-none tracking-normal outline-none placeholder:text-inherit",
              disabled && "cursor-not-allowed opacity-60",
              isLarge ? "text-4xl xl:text-5xl" : "text-3xl",
              prefix ? "w-full" : "w-full"
            )}
          />
        </div>
        {subtitle ? (
          <Text
            variant="body-default"
            className="shrink-0 whitespace-nowrap text-nowrap italic text-zinc-400"
          >
            {subtitle}
          </Text>
        ) : null}
      </div>
      {trailing}
    </div>
  );
}

export const CurrencyField = Object.assign(Root, {
  Label,
  Control,
});
