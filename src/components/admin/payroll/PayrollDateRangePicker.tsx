import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subWeeks,
  subMonths,
  subDays,
  addDays,
  differenceInCalendarDays,
} from "date-fns";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";

interface PayrollDateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onChange: (range: { startDate: Date; endDate: Date }) => void;
}

type PresetKey =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_30_days"
  | "custom";

const PRESETS: { key: PresetKey; label: string; build: () => { startDate: Date; endDate: Date } }[] = [
  {
    key: "this_week",
    label: "This Week",
    build: () => {
      const now = new Date();
      return {
        startDate: startOfWeek(now, { weekStartsOn: 1 }),
        endDate: endOfWeek(now, { weekStartsOn: 1 }),
      };
    },
  },
  {
    key: "last_week",
    label: "Last Week",
    build: () => {
      const lw = subWeeks(new Date(), 1);
      return {
        startDate: startOfWeek(lw, { weekStartsOn: 1 }),
        endDate: endOfWeek(lw, { weekStartsOn: 1 }),
      };
    },
  },
  {
    key: "this_month",
    label: "This Month",
    build: () => {
      const now = new Date();
      return { startDate: startOfMonth(now), endDate: endOfMonth(now) };
    },
  },
  {
    key: "last_month",
    label: "Last Month",
    build: () => {
      const lm = subMonths(new Date(), 1);
      return { startDate: startOfMonth(lm), endDate: endOfMonth(lm) };
    },
  },
  {
    key: "last_30_days",
    label: "Last 30 Days",
    build: () => {
      const today = new Date();
      return { startDate: subDays(today, 29), endDate: today };
    },
  },
];

function detectPreset(startDate: Date, endDate: Date): PresetKey {
  for (const preset of PRESETS) {
    const candidate = preset.build();
    if (
      format(candidate.startDate, "yyyy-MM-dd") === format(startDate, "yyyy-MM-dd") &&
      format(candidate.endDate, "yyyy-MM-dd") === format(endDate, "yyyy-MM-dd")
    ) {
      return preset.key;
    }
  }
  return "custom";
}

function formatRange(startDate: Date, endDate: Date): string {
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
  if (sameMonth && startDate.getDate() === endDate.getDate()) {
    return format(startDate, "MMM d, yyyy");
  }
  if (sameMonth) {
    return `${format(startDate, "MMM d")} – ${format(endDate, "d, yyyy")}`;
  }
  if (sameYear) {
    return `${format(startDate, "MMM d")} – ${format(endDate, "MMM d, yyyy")}`;
  }
  return `${format(startDate, "MMM d, yyyy")} – ${format(endDate, "MMM d, yyyy")}`;
}

export default function PayrollDateRangePicker({
  startDate,
  endDate,
  onChange,
}: PayrollDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const activePreset = detectPreset(startDate, endDate);
  const rangeDays = differenceInCalendarDays(endDate, startDate) + 1;

  const applyPreset = (key: PresetKey) => {
    const preset = PRESETS.find(p => p.key === key);
    if (!preset) return;
    onChange(preset.build());
    setOpen(false);
  };

  const handleCalendarSelect = (range: DateRange | undefined) => {
    if (range?.from && range?.to) {
      onChange({ startDate: range.from, endDate: range.to });
      setOpen(false);
    } else if (range?.from && !range?.to) {
      onChange({ startDate: range.from, endDate: range.from });
    }
  };

  const shiftRange = (direction: -1 | 1) => {
    const offset = direction * rangeDays;
    onChange({
      startDate: addDays(startDate, offset),
      endDate: addDays(endDate, offset),
    });
  };

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex flex-col gap-3">
          {/* Top row: prev/next + main picker button */}
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => shiftRange(-1)}
              className="h-9 w-9"
              title="Previous Period"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "min-w-[280px] justify-center text-base font-semibold h-9",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {formatRange(startDate, endDate)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="center">
                <div className="flex flex-col md:flex-row">
                  {/* Presets sidebar */}
                  <div className="flex flex-col gap-1 border-b md:border-b-0 md:border-r p-2 min-w-[180px]">
                    <p className="text-xs font-semibold text-muted-foreground px-2 pt-1 pb-2 uppercase tracking-wide">
                      Shortcuts
                    </p>
                    {PRESETS.map(preset => (
                      <Button
                        key={preset.key}
                        variant={activePreset === preset.key ? "secondary" : "ghost"}
                        size="sm"
                        className="justify-start"
                        onClick={() => applyPreset(preset.key)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                    <div className="border-t my-1" />
                    <p className="text-xs text-muted-foreground px-2 pb-1">
                      Or pick dates in the calendar →
                    </p>
                  </div>
                  {/* Calendar */}
                  <Calendar
                    mode="range"
                    selected={{ from: startDate, to: endDate }}
                    onSelect={handleCalendarSelect}
                    numberOfMonths={2}
                    weekStartsOn={1}
                    defaultMonth={startDate}
                  />
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="outline"
              size="icon"
              onClick={() => shiftRange(1)}
              className="h-9 w-9"
              title="Next Period"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Bottom row: preset chips for quick switching */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {PRESETS.map(preset => (
              <Button
                key={preset.key}
                size="sm"
                variant={activePreset === preset.key ? "default" : "outline"}
                onClick={() => applyPreset(preset.key)}
                className="h-7 px-3 text-xs"
              >
                {preset.label}
              </Button>
            ))}
            {activePreset === "custom" && (
              <span className="text-xs text-muted-foreground italic">
                Custom range ({rangeDays} {rangeDays === 1 ? "day" : "days"})
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
